import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  checkHealth,
  syncTransactions,
  fetchItemsPage,
  fetchItemsVersion,
} from "./api";
import {
  getPendingTransactions,
  markTransactionsSynced,
  upsertItems,
  clearAllItems,
} from "../database/db";

let _onStatusChange = null;

export const setSyncStatusListener = (fn) => {
  _onStatusChange = fn;
  return () => {
    _onStatusChange = null;
  };
};

const notifyStatus = (status) => {
  if (_onStatusChange) _onStatusChange(status);
};

export const checkConnectivity = async () => {
  if (Platform.OS === "web") {
    return navigator.onLine;
  }
  try {
    const Network = require("expo-network");
    const state = await Network.getNetworkStateAsync();
    return state.isConnected && state.isInternetReachable !== false;
  } catch {
    return false;
  }
};

// Pull latest item master if server version differs from local
const pullItemsIfNeeded = async () => {
  try {
    const serverVer = await fetchItemsVersion();
    const localVer = await AsyncStorage.getItem("itemsVersion");
    if (localVer === String(serverVer.version)) return; // already up-to-date

    await clearAllItems();
    let page = 1;
    const limit = 2000;
    while (true) {
      const chunk = await fetchItemsPage(page, limit);
      const items = chunk.items || [];
      if (items.length > 0) {
        await upsertItems(
          items.map((i) => ({
            ItemCode: i.ItemCode,
            Barcode: i.Barcode,
            Item_Name: i.Item_Name,
          })),
        );
      }
      const total = chunk.total || 0;
      const loaded = page * limit;
      if (loaded >= total || items.length === 0) break;
      page++;
    }
    await AsyncStorage.setItem("itemsVersion", String(serverVer.version));
  } catch (_) {
    // Item pull failure must not break sync
  }
};

// Chunk large transaction arrays to avoid payload limits
const CHUNK_SIZE = 200;
const syncInChunks = async (payload) => {
  let totalSynced = 0;
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    const result = await syncTransactions(chunk);
    totalSynced += result.synced ?? chunk.length;
  }
  return totalSynced;
};

export const attemptSync = async () => {
  const isConnected = await checkConnectivity();
  if (!isConnected) {
    notifyStatus({ online: false, lastSync: null, pendingCount: null });
    return { synced: 0, reason: "offline" };
  }

  // Check that our backend is actually reachable on the LAN
  try {
    await checkHealth();
  } catch {
    notifyStatus({ online: false, lastSync: null, pendingCount: null });
    return { synced: 0, reason: "backend_unreachable" };
  }

  notifyStatus({ online: true, lastSync: null, pendingCount: null });

  // ALWAYS pull latest items when online (version-aware to save bandwidth)
  await pullItemsIfNeeded();

  const pending = await getPendingTransactions();
  if (pending.length === 0) {
    const lastSync = new Date().toISOString();
    notifyStatus({ online: true, lastSync, pendingCount: 0 });
    return { synced: 0, reason: "nothing_pending", lastSync };
  }

  // Read worker name saved by LoginScreen
  const workerName = (await AsyncStorage.getItem("workerName")) || "unknown";

  // Map SQLite rows to the shape the backend expects
  const payload = pending.map((tx) => ({
    Item_Barcode: tx.item_barcode,
    Item_Code: tx.item_code || "",
    Item_Name: tx.item_name,
    Frombin: tx.frombin,
    Tobin: tx.tobin,
    Qty: tx.qty,
    Timestamp: tx.timestamp,
    Notes: tx.notes || "",
    deviceId: workerName,
  }));

  let synced = 0;
  try {
    synced = await syncInChunks(payload);
    const ids = pending.map((tx) => tx.id);
    await markTransactionsSynced(ids);
  } catch (err) {
    return { synced: 0, reason: "sync_failed", error: err.message };
  }

  const lastSync = new Date().toISOString();
  notifyStatus({ online: true, lastSync, pendingCount: 0 });
  return { synced, reason: "success", lastSync };
};

export const startAutoSync = (intervalMs = 30000) => {
  // Delay the first run so the app can finish rendering before hitting the network
  const firstRun = setTimeout(attemptSync, 2000);
  const timer = setInterval(attemptSync, intervalMs);
  return () => {
    clearTimeout(firstRun);
    clearInterval(timer);
  };
};
