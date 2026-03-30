import { Platform } from 'react-native';
import { checkHealth, syncTransactions } from './api';
import {
  getPendingTransactions,
  markTransactionsSynced,
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

  // Map SQLite rows to the shape the backend expects
  const payload = pending.map((tx) => ({
    Item_Barcode: tx.item_barcode,
    Item_Name: tx.item_name,
    Frombin: tx.frombin,
    Tobin: tx.tobin,
    Qty: tx.qty,
    Timestamp: tx.timestamp,
    deviceId: 'mobile',
  }));

  try {
    const result = await syncTransactions(payload);
    const ids = pending.map((tx) => tx.id);
    await markTransactionsSynced(ids);
    const lastSync = new Date().toISOString();
    notifyStatus({ online: true, lastSync, pendingCount: 0 });
    return { synced: result.synced ?? ids.length, reason: 'success', lastSync };
  } catch (err) {
    return { synced: 0, reason: 'sync_failed', error: err.message };
  }
};

export const startAutoSync = (intervalMs = 30000) => {
  // Run immediately on start
  attemptSync();
  const timer = setInterval(attemptSync, intervalMs);
  return () => clearInterval(timer);
};
