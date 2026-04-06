import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkHealth, syncTransactions, fetchItems } from './api';
import {
  getPendingTransactions,
  markTransactionsSynced,
  upsertItems,
  clearSyncedTransactions,
  clearAllItems,
} from '../database/db';

let _onStatusChange = null;

export const setSyncStatusListener = (fn) => {
  _onStatusChange = fn;
};

const notifyStatus = (status) => {
  if (_onStatusChange) _onStatusChange(status);
};

export const checkConnectivity = async () => {
  if (Platform.OS === 'web') {
    return navigator.onLine;
  }
  try {
    const Network = require('expo-network');
    const state = await Network.getNetworkStateAsync();
    return state.isConnected && state.isInternetReachable !== false;
  } catch {
    return false;
  }
};

export const attemptSync = async () => {
  const isConnected = await checkConnectivity();
  if (!isConnected) {
    notifyStatus({ online: false, lastSync: null, pendingCount: null });
    return { synced: 0, reason: 'offline' };
  }

  // Check that our backend is actually reachable on the LAN
  try {
    await checkHealth();
  } catch {
    notifyStatus({ online: false, lastSync: null, pendingCount: null });
    return { synced: 0, reason: 'backend_unreachable' };
  }

  notifyStatus({ online: true, lastSync: null, pendingCount: null });

  const pending = await getPendingTransactions();
  if (pending.length === 0) {
    return { synced: 0, reason: 'nothing_pending' };
  }

  // Read worker name saved by LoginScreen
  const workerName = (await AsyncStorage.getItem('workerName')) || 'unknown';

  // Map SQLite rows to the shape the backend expects
  const payload = pending.map((tx) => ({
    Item_Barcode: tx.item_barcode,
    Item_Code: tx.item_code || '',
    Item_Name: tx.item_name,
    Frombin: tx.frombin,
    Tobin: tx.tobin,
    Qty: tx.qty,
    Timestamp: tx.timestamp,
    deviceId: workerName,
  }));

  let synced = 0;
  try {
    const result = await syncTransactions(payload);
    const ids = pending.map((tx) => tx.id);
    await markTransactionsSynced(ids);
    synced = result.synced ?? ids.length;
  } catch (err) {
    return { synced: 0, reason: 'sync_failed', error: err.message };
  }

  // Pull latest item master from backend so worker always has new items
  try {
    const latestItems = await fetchItems();
    if (latestItems && latestItems.length > 0) {
      // Replace local items with server items (handles admin re-import)
      await clearAllItems();
      await upsertItems(latestItems.map((i) => ({
        ItemCode: i.ItemCode,
        Barcode: i.Barcode,
        Item_Name: i.Item_Name,
      })));
    }
  } catch (_) {
    // Item pull failure must not break transaction sync
  }

  // Clean up: remove synced transactions from phone to keep it lean
  try {
    await clearSyncedTransactions();
  } catch (_) {}

  const lastSync = new Date().toISOString();
  notifyStatus({ online: true, lastSync, pendingCount: 0 });
  return { synced, reason: 'success', lastSync };
};

export const startAutoSync = (intervalMs = 30000) => {
  // Delay the first run so the app can finish rendering before hitting the network
  const firstRun = setTimeout(attemptSync, 2000);
  const timer = setInterval(attemptSync, intervalMs);
  return () => { clearTimeout(firstRun); clearInterval(timer); };
};
