import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  checkHealth,
  syncTransactions,
  verifySyncedTxIds,
  fetchItemsBulk,
  fetchItemsDelta,
  fetchItemsVersion,
  getServerTimeISO,
  checkClearCommand,
  ackClear,
} from "./api";
import {
  getPendingTransactions,
  markTransactionsSynced,
  clearAndReplaceAllItems,
  upsertItems,
  clearSyncedTransactions,
} from "../database/db";

let _onStatusChange = null;
let _onDataCleared = null;

export const setSyncStatusListener = (fn) => {
  _onStatusChange = fn;
  return () => {
    _onStatusChange = null;
  };
};

export const setDataClearedListener = (fn) => {
  _onDataCleared = fn;
  return () => {
    _onDataCleared = null;
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

// ─── Item Master Download (standalone, admin-triggered only) ─────────────────
// Downloads ALL items in one bulk request, then atomically replaces local DB.
// If download fails, local items are UNTOUCHED (no clearing).
export const downloadItemMaster = async (onProgress) => {
  onProgress?.({ phase: "downloading", percent: 0 });

  // 1. Download all items into memory (single compressed JSON response)
  const data = await fetchItemsBulk();
  const items = data.items || [];
  const serverVersion = data.version;

  if (items.length === 0) {
    return {
      success: false,
      count: 0,
      version: serverVersion,
      error: "Server has no items",
    };
  }

  onProgress?.({ phase: "downloading", percent: 100 });
  onProgress?.({ phase: "saving", percent: 0 });

  // 2. Atomically replace local DB (clear + insert in one transaction)
  // If this fails mid-way, SQLite rolls back — previous data stays intact
  await clearAndReplaceAllItems(items, ({ processed, total }) => {
    onProgress?.({
      phase: "saving",
      percent: Math.round((processed / total) * 100),
    });
  });

  // 3. Save version and sync timestamps ONLY after successful write
  const syncNow = new Date().toISOString();
  await Promise.all([
    AsyncStorage.setItem("itemsVersion", String(serverVersion)),
    AsyncStorage.setItem("lastItemSyncTime", syncNow),
    AsyncStorage.setItem("lastItemFullSync", syncNow),
  ]);

  onProgress?.({ phase: "done", percent: 100 });
  return { success: true, count: items.length, version: serverVersion, delta: false };
};

// ─── Smart Delta Sync ─────────────────────────────────────────────────────────
// Downloads only new/updated items since last sync. Falls back to full download
// if this is the first sync ever, or if the admin did a full replace.
//
// AsyncStorage keys used:
//   itemsVersion       — version number of last successful download
//   lastItemSyncTime   — ISO timestamp of last delta or full download
//   lastItemFullSync   — ISO timestamp of last FULL (bulk) download
export const downloadItemDelta = async (onProgress) => {
  const [lastSyncTime, lastFullSync, localVerStr] = await Promise.all([
    AsyncStorage.getItem("lastItemSyncTime"),
    AsyncStorage.getItem("lastItemFullSync"),
    AsyncStorage.getItem("itemsVersion"),
  ]);

  // First time or no sync time → must do full download
  if (!lastSyncTime || !localVerStr) {
    return downloadItemMaster(onProgress);
  }

  onProgress?.({ phase: "checking", percent: 0 });

  let deltaData;
  try {
    deltaData = await fetchItemsDelta(lastSyncTime, lastFullSync);
  } catch (err) {
    // Network error on delta → fall back to full download
    return downloadItemMaster(onProgress);
  }

  // Server says a full replace happened after our last full sync → full download
  if (deltaData.requiresFullSync) {
    return downloadItemMaster(onProgress);
  }

  const { items, total, version, serverTime } = deltaData;

  // Nothing changed
  if (total === 0) {
    onProgress?.({ phase: "done", percent: 100 });
    return { success: true, count: 0, version, delta: true, unchanged: true };
  }

  onProgress?.({ phase: "saving", percent: 0 });

  // Upsert only the changed items — existing items stay untouched
  await upsertItems(items);

  // Save updated sync timestamps and version
  await Promise.all([
    AsyncStorage.setItem("itemsVersion", String(version)),
    AsyncStorage.setItem("lastItemSyncTime", serverTime),
  ]);

  onProgress?.({ phase: "done", percent: 100 });
  return { success: true, count: total, version, delta: true };
};

// Check if a newer item master version is available on server
export const checkItemMasterUpdate = async () => {
  const serverData = await fetchItemsVersion();
  const localVer = await AsyncStorage.getItem("itemsVersion");
  return {
    serverVersion: serverData.version,
    serverCount: serverData.totalItems ?? 0,
    localVersion: localVer ? Number(localVer) : null,
    updateAvailable: localVer !== String(serverData.version),
  };
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

  // Item master is NO LONGER auto-synced here.
  // Admin pushes master explicitly; workers download via AdminPanel.

  const pending = await getPendingTransactions();
  if (pending.length === 0) {
    // Even with nothing to sync, check for admin clear commands
    try {
      const clearRes = await checkClearCommand();
      if (clearRes?.clearBefore) {
        // Admin requested phone cleanup — clear only SYNCED transactions, keep unsynced
        const cleared = await clearSyncedTransactions();
        if (cleared > 0) {
          console.log(
            `[Sync] Cleared ${cleared} synced transactions (admin command)`,
          );
        }
        await ackClear();
        if (_onDataCleared) _onDataCleared();
      }
    } catch (e) {
      console.log("[Sync] Clear check failed:", e.message);
    }
    const lastSync = await getServerTimeISO();
    notifyStatus({ online: true, lastSync, pendingCount: 0 });
    return { synced: 0, reason: "nothing_pending", lastSync };
  }

  // Read worker name saved by LoginScreen
  const workerName = (await AsyncStorage.getItem("workerName")) || "unknown";

  // Map SQLite rows to the shape the backend expects
  const payload = pending.map((tx) => ({
    Client_Tx_Id: tx.client_tx_id,
    UpdatedAt: tx.updated_at || tx.timestamp,
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
    // Sync POST timed out or network dropped AFTER server saved the data.
    // Verify which transactions the server already has and mark those as synced
    // so they don't get re-sent forever (fixes stuck-pending on slow phones).
    try {
      const clientTxIds = pending
        .map((tx) => tx.client_tx_id)
        .filter(Boolean);
      if (clientTxIds.length > 0) {
        const verifyRes = await verifySyncedTxIds(clientTxIds);
        if (verifyRes?.found?.length > 0) {
          const foundSet = new Set(verifyRes.found);
          const verifiedIds = pending
            .filter((tx) => tx.client_tx_id && foundSet.has(tx.client_tx_id))
            .map((tx) => tx.id);
          if (verifiedIds.length > 0) {
            await markTransactionsSynced(verifiedIds);
            synced = verifiedIds.length;
            // Return partial success so caller knows some were synced
            const lastSync = await getServerTimeISO();
            notifyStatus({ online: true, lastSync, pendingCount: pending.length - synced });
            return { synced, reason: "partial_verified", lastSync };
          }
        }
      }
    } catch (_) {
      // verify also failed — truly offline or server down
    }
    return { synced: 0, reason: "sync_failed", error: err.message };
  }

  // Check for remote clear command from admin
  try {
    const clearRes = await checkClearCommand();
    if (clearRes?.clearBefore) {
      // Admin requested phone cleanup — clear only SYNCED transactions, keep unsynced
      const cleared = await clearSyncedTransactions();
      if (cleared > 0) {
        console.log(
          `[Sync] Cleared ${cleared} synced transactions (admin command)`,
        );
      }
      await ackClear();
      if (_onDataCleared) _onDataCleared();
    }
  } catch (e) {
    console.log("[Sync] Clear check failed:", e.message);
  }

  const lastSync = await getServerTimeISO();
  notifyStatus({ online: true, lastSync, pendingCount: 0 });
  return { synced, reason: "success", lastSync };
};

export const startAutoSync = (intervalMs = 15000) => {
  // Delay the first run so the app can finish rendering before hitting the network
  const firstRun = setTimeout(attemptSync, 2000);
  const timer = setInterval(attemptSync, intervalMs);
  return () => {
    clearTimeout(firstRun);
    clearInterval(timer);
  };
};
