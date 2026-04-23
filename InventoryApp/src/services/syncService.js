import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  checkHealth,
  syncTransactions,
  verifySyncedTxIds,
  fetchItemsBulk,
  fetchItemsBulkPage,
  fetchItemsDelta,
  fetchItemsVersion,
  getServerTimeISO,
  checkClearCommand,
  ackClear,
  fetchBinContentVersion,
  fetchBinContentBulk,
  fetchBinContentDelta,
  fetchBinMasterCodes,
  fetchBinMasterVersion,
} from "./api";
import {
  getPendingTransactions,
  markTransactionsSynced,
  clearAndReplaceAllItems,
  upsertItems,
  clearSyncedTransactions,
  clearAndReplaceBinContents,
  upsertBinContents,
  getBinContentCount,
  clearAndReplaceBinMaster,
  getBinMasterCount,
  deleteAllItemRows,
  insertItemsPage,
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
// PRIMARY: single gzip request served from server RAM cache — one round-trip.
// FALLBACK: paginated — 2000 items (~200 KB JSON) per page so 1 GB RAM phones
// never OOM. 30 K item master = ~15 small requests instead of one giant blob.
const PAGE_SIZE = 2000;
export const downloadItemMaster = async (onProgress) => {
  onProgress?.({ phase: "downloading", percent: 0 });

  // ── PRIMARY: /bulk endpoint — pre-gzipped, served from RAM, one request ──
  try {
    let data = await fetchItemsBulk();
    const items = data.items || [];
    const serverVersion = data.version;
    data = null; // release before DB write

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

    const inserted = await clearAndReplaceAllItems(
      items,
      ({ processed, total }) => {
        onProgress?.({
          phase: "saving",
          percent: Math.round((processed / total) * 100),
        });
      },
    );

    const syncNow = new Date().toISOString();
    await Promise.all([
      AsyncStorage.setItem("itemsVersion", String(serverVersion)),
      AsyncStorage.setItem("lastItemSyncTime", syncNow),
      AsyncStorage.setItem("lastItemFullSync", syncNow),
    ]);

    onProgress?.({ phase: "done", percent: 100 });
    return {
      success: true,
      count: inserted,
      version: serverVersion,
      delta: false,
    };
  } catch (bulkErr) {
    // Only fall through to paginated on server/network errors, not auth/logic errors
    const status = bulkErr?.response?.status;
    if (status && status !== 500 && status !== 503 && status !== 504) {
      throw bulkErr;
    }
    // fall through to paginated fallback below
    console.warn(
      "[downloadItemMaster] bulk failed, trying paginated:",
      bulkErr.message,
    );
  }

  // ── FALLBACK: paginated download (larger pages = fewer requests) ──────────
  let firstPage;
  try {
    firstPage = await fetchItemsBulkPage(1, PAGE_SIZE);
  } catch (err) {
    throw err;
  }

  const serverVersion = firstPage.version;
  const totalPages = firstPage.totalPages;
  const totalItems = firstPage.totalItems;

  if (totalItems === 0 || firstPage.items.length === 0) {
    return {
      success: false,
      count: 0,
      version: serverVersion,
      error: "Server has no items",
    };
  }

  await deleteAllItemRows();

  let totalInserted = await insertItemsPage(firstPage.items);
  firstPage = null;

  onProgress?.({
    phase: "downloading",
    percent: Math.round((1 / totalPages) * 100),
  });

  const PARALLEL_PAGES = 3;
  for (let page = 2; page <= totalPages; page += PARALLEL_PAGES) {
    const end = Math.min(page + PARALLEL_PAGES, totalPages + 1);
    const fetches = [];
    for (let p = page; p < end; p++) fetches.push(fetchItemsBulkPage(p, PAGE_SIZE));
    const batchData = await Promise.all(fetches);
    for (const pageData of batchData) {
      totalInserted += await insertItemsPage(pageData.items);
    }

    onProgress?.({
      phase: "downloading",
      percent: Math.round((Math.min(end - 1, totalPages) / totalPages) * 100),
    });
  }

  const syncNow = new Date().toISOString();
  await Promise.all([
    AsyncStorage.setItem("itemsVersion", String(serverVersion)),
    AsyncStorage.setItem("lastItemSyncTime", syncNow),
    AsyncStorage.setItem("lastItemFullSync", syncNow),
  ]);

  onProgress?.({ phase: "done", percent: 100 });
  return {
    success: true,
    count: totalInserted,
    version: serverVersion,
    delta: false,
  };
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
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + CHUNK_SIZE));
  }
  const results = await Promise.all(chunks.map((chunk) => syncTransactions(chunk)));
  return results.reduce((sum, r) => sum + (r.synced ?? 0), 0);
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
        await AsyncStorage.setItem("phoneClearedAt", new Date().toISOString());
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
      const clientTxIds = pending.map((tx) => tx.client_tx_id).filter(Boolean);
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
            notifyStatus({
              online: true,
              lastSync,
              pendingCount: pending.length - synced,
            });
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
      await AsyncStorage.setItem("phoneClearedAt", new Date().toISOString());
      if (_onDataCleared) _onDataCleared();
    }
  } catch (e) {
    console.log("[Sync] Clear check failed:", e.message);
  }

  const lastSync = await getServerTimeISO();
  notifyStatus({ online: true, lastSync, pendingCount: 0 });
  return { synced, reason: "success", lastSync };
};

export const startAutoSync = (intervalMs = 60000) => {
  // Delay the first run so the app can finish rendering before hitting the network
  const firstRunDelay = Math.min(
    12000,
    Math.max(4000, Math.round(intervalMs / 3)),
  );
  const firstRun = setTimeout(attemptSync, firstRunDelay);
  const timer = setInterval(attemptSync, intervalMs);
  return () => {
    clearTimeout(firstRun);
    clearInterval(timer);
  };
};

// ─── Bin Content Sync ─────────────────────────────────────────────────────────

// Full bulk download of ALL bin content records. Atomic replace of local data.
// Automatically ensures bin master is synced first.
// onProgress: ({ phase, percent })
export const downloadBinContent = async (onProgress) => {
  // Step 0: Ensure bin master is up to date (auto-download if needed)
  onProgress?.({ phase: "bin_master", percent: 0 });
  await ensureBinMasterSynced((p) => {
    if (p.phase === "downloading")
      onProgress?.({ phase: "bin_master", percent: 30 });
    if (p.phase === "saving")
      onProgress?.({ phase: "bin_master", percent: 60 });
    if (p.phase === "done") onProgress?.({ phase: "bin_master", percent: 100 });
  });

  onProgress?.({ phase: "downloading", percent: 0 });

  const storedEtag = await AsyncStorage.getItem("binContentEtag");
  const data = await fetchBinContentBulk(storedEtag);

  if (data.notModified) {
    onProgress?.({ phase: "done", percent: 100 });
    return { success: true, count: 0, notModified: true };
  }

  const items = data.items || [];
  const serverVersion = data.version;

  if (items.length === 0) {
    return {
      success: false,
      count: 0,
      version: serverVersion,
      error: "Server has no bin content",
    };
  }

  onProgress?.({ phase: "downloading", percent: 100 });
  onProgress?.({ phase: "saving", percent: 0 });

  await clearAndReplaceBinContents(items, ({ processed, total }) => {
    onProgress?.({
      phase: "saving",
      percent: Math.round((processed / total) * 100),
    });
  });

  const syncNow = new Date().toISOString();
  await Promise.all([
    AsyncStorage.setItem("binContentVersion", String(serverVersion)),
    AsyncStorage.setItem("lastBinContentSyncTime", syncNow),
    AsyncStorage.setItem("binContentEtag", `"binv${serverVersion}"`),
  ]);

  onProgress?.({ phase: "done", percent: 100 });
  return { success: true, count: items.length, version: serverVersion };
};

// Delta sync — download only records updated since last sync.
// Falls back to full download if no local version exists.
// Automatically ensures bin master is synced first.
export const downloadBinContentDelta = async (onProgress) => {
  // Step 0: Ensure bin master is up to date
  await ensureBinMasterSynced();

  const [lastSyncTime, localVerStr] = await Promise.all([
    AsyncStorage.getItem("lastBinContentSyncTime"),
    AsyncStorage.getItem("binContentVersion"),
  ]);

  if (!lastSyncTime || !localVerStr) {
    return downloadBinContent(onProgress);
  }

  onProgress?.({ phase: "checking", percent: 0 });

  let deltaData;
  try {
    deltaData = await fetchBinContentDelta(lastSyncTime);
  } catch {
    return downloadBinContent(onProgress);
  }

  const { items, total, version, serverTime } = deltaData;

  if (total === 0) {
    onProgress?.({ phase: "done", percent: 100 });
    return { success: true, count: 0, version, delta: true, unchanged: true };
  }

  onProgress?.({ phase: "saving", percent: 0 });
  await upsertBinContents(items);

  await Promise.all([
    AsyncStorage.setItem("binContentVersion", String(version)),
    AsyncStorage.setItem("lastBinContentSyncTime", serverTime),
  ]);

  onProgress?.({ phase: "done", percent: 100 });
  return { success: true, count: total, version, delta: true };
};

// Check if a newer bin content version is available on the server.
// Returns { serverVersion, serverTotal, localVersion, localCount, updateAvailable }
export const checkBinContentUpdate = async () => {
  const serverData = await fetchBinContentVersion();
  const [localVer, localCount] = await Promise.all([
    AsyncStorage.getItem("binContentVersion"),
    getBinContentCount(),
  ]);
  return {
    serverVersion: serverData.version,
    serverTotal: serverData.total ?? 0,
    localVersion: localVer ? Number(localVer) : null,
    localCount,
    updateAvailable:
      localVer !== String(serverData.version) || localCount === 0,
  };
};

// ─── Bin Master Download ─────────────────────────────────────────────────────
// Downloads ALL bin codes from the server and saves to local bin_master table.
// Used by the hard-block bin existence check in ScannerScreen.
export const downloadBinMaster = async (onProgress) => {
  onProgress?.({ phase: "downloading", percent: 0 });
  const data = await fetchBinMasterCodes();
  const codes = data.codes || [];
  const serverVersion = data.version ?? data.total ?? codes.length;
  if (codes.length === 0) {
    return {
      success: false,
      count: 0,
      error: "Server has no bin master records",
    };
  }
  onProgress?.({ phase: "saving", percent: 50 });
  await clearAndReplaceBinMaster(codes);
  const syncNow = new Date().toISOString();
  await Promise.all([
    AsyncStorage.setItem("binMasterVersion", String(serverVersion)),
    AsyncStorage.setItem("lastBinMasterSyncTime", syncNow),
  ]);
  onProgress?.({ phase: "done", percent: 100 });
  return { success: true, count: codes.length, version: serverVersion };
};

// Check if bin master has a newer version on the server.
// Returns { serverVersion, serverTotal, localVersion, localCount, updateAvailable }
export const checkBinMasterUpdate = async () => {
  const serverData = await fetchBinMasterVersion();
  const [localVer, localCount] = await Promise.all([
    AsyncStorage.getItem("binMasterVersion"),
    getBinMasterCount(),
  ]);
  return {
    serverVersion: serverData.version,
    serverTotal: serverData.total ?? 0,
    localVersion: localVer ? Number(localVer) : null,
    localCount,
    updateAvailable:
      localVer !== String(serverData.version) || localCount === 0,
  };
};

// Ensures the local bin master is up to date. Skips download if version matches.
// Called automatically before bin content download.
export const ensureBinMasterSynced = async (onProgress) => {
  try {
    const status = await checkBinMasterUpdate();
    if (!status.updateAvailable && status.localCount > 0) {
      return { skipped: true, count: status.localCount };
    }
    return await downloadBinMaster(onProgress);
  } catch (err) {
    // If bin master check fails but we already have local data, continue silently
    const localCount = await getBinMasterCount();
    if (localCount > 0) return { skipped: true, count: localCount };
    throw err;
  }
};

// Returns local bin master count + last sync time for display in admin panel.
export const checkBinMasterStatus = async () => {
  const [localCount, lastSync] = await Promise.all([
    getBinMasterCount(),
    AsyncStorage.getItem("lastBinMasterSyncTime"),
  ]);
  return { localCount, lastSync };
};

// ─── Fast Clear-Command Poller ────────────────────────────────────────────────
// Independently polls for admin "Clear Phone" commands every 5 seconds.
// Does NOT do a full sync — just checks the flag and clears local data immediately.
export const startClearPoller = (intervalMs = 15000) => {
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const isConnected = await checkConnectivity();
      if (!isConnected) return;
      const clearRes = await checkClearCommand();
      if (clearRes?.clearBefore) {
        const cleared = await clearSyncedTransactions();
        await ackClear();
        if (cleared > 0) {
          console.log(
            `[ClearPoller] Cleared ${cleared} synced transactions (admin command)`,
          );
        }
        if (_onDataCleared) _onDataCleared();
      }
    } catch (_) {
      // silently ignore — full sync will retry
    } finally {
      running = false;
    }
  };
  const timer = setInterval(poll, intervalMs);
  return () => clearInterval(timer);
};
