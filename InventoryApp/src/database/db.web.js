/**
 * Web-only database shim using IndexedDB (for items) + localStorage (for transactions).
 * IndexedDB supports large datasets and bulk inserts without size limits.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// Get server-aligned time using stored offset from last health check
const getServerNow = async () => {
  try {
    const offsetStr = await AsyncStorage.getItem("serverTimeOffset");
    const offset = offsetStr ? Number(offsetStr) : 0;
    return new Date(Date.now() + offset).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const makeClientTxId = (
  workerName = "unknown",
  timestamp = new Date().toISOString(),
) => {
  const safeWorker = String(workerName || "unknown").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  const timePart = new Date(timestamp).getTime().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `tx_${safeWorker}_${timePart}_${randomPart}`;
};

const normalizeIsoString = (value) => {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

const buildRestoreFallbackId = ({
  worker_name = "unknown",
  item_barcode = "unknown",
  timestamp,
}) => {
  const safeWorker = String(worker_name || "unknown").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  const safeBarcode = String(item_barcode || "unknown").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  const timePart = new Date(timestamp || Date.now()).getTime().toString(36);
  return `restored_${safeWorker}_${safeBarcode}_${timePart}`;
};

const normalizeRestoreTx = (tx) => {
  const item_barcode = String(tx?.item_barcode || "").trim();
  const item_name = String(tx?.item_name || "").trim();
  const frombin = String(tx?.frombin || "")
    .trim()
    .toUpperCase();
  const tobin = String(tx?.tobin || "")
    .trim()
    .toUpperCase();
  const qty = Number(tx?.qty);

  if (!item_barcode || !item_name || !frombin || !tobin || !qty || qty < 1) {
    return null;
  }

  const timestamp = normalizeIsoString(tx?.timestamp);
  const worker_name = String(tx?.worker_name || "unknown").trim() || "unknown";
  const client_tx_id =
    String(tx?.client_tx_id || "").trim() ||
    buildRestoreFallbackId({ worker_name, item_barcode, timestamp });

  return {
    item_barcode,
    item_code: String(tx?.item_code || "").trim(),
    item_name,
    frombin,
    tobin,
    qty,
    timestamp,
    synced: Number(tx?.synced) === 1 ? 1 : 0,
    worker_name,
    notes: String(tx?.notes || "").trim(),
    client_tx_id,
    updated_at: normalizeIsoString(tx?.updated_at || timestamp),
  };
};

// ─── IndexedDB for Items ──────────────────────────────────────────────────────

const IDB_NAME = "inventory_db";
const IDB_VERSION = 3; // bumped to add bin_master store
const ITEMS_STORE = "items";
const BIN_CONTENTS_STORE = "bin_contents";
const BIN_MASTER_STORE = "bin_master";
let _idb = null;

const openIDB = () =>
  new Promise((resolve, reject) => {
    if (_idb) return resolve(_idb);
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        db.createObjectStore(ITEMS_STORE, { keyPath: "barcode" });
      }
      if (!db.objectStoreNames.contains(BIN_CONTENTS_STORE)) {
        const binStore = db.createObjectStore(BIN_CONTENTS_STORE, {
          keyPath: "_key",
        });
        binStore.createIndex("item_code", "item_code", { unique: false });
      }
      if (!db.objectStoreNames.contains(BIN_MASTER_STORE)) {
        db.createObjectStore(BIN_MASTER_STORE, { keyPath: "bin_code" });
      }
    };
    req.onsuccess = (e) => {
      _idb = e.target.result;
      resolve(_idb);
    };
    req.onerror = (e) => reject(e.target.error);
  });

// ─── In-Memory Cache ──────────────────────────────────────────────────────────
// Loaded once via getAll() (bulk read, much faster than cursor), then all
// searches are pure in-memory JS — near-instant regardless of dataset size.
let _itemsCache = null;

const getItemsCache = async () => {
  if (_itemsCache) return _itemsCache;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(ITEMS_STORE, "readonly")
      .objectStore(ITEMS_STORE)
      .getAll();
    req.onsuccess = () => {
      _itemsCache = req.result || [];
      resolve(_itemsCache);
    };
    req.onerror = (e) => reject(e.target.error);
  });
};

// ─── localStorage for Transactions (small dataset) ───────────────────────────

const KEY_TRANSACTIONS = "inv_transactions";
const normalizeTxRecord = (tx) => {
  const next = { ...tx };
  let changed = false;

  if (!next.worker_name) {
    next.worker_name = "unknown";
    changed = true;
  }
  if (typeof next.notes !== "string") {
    next.notes = next.notes ? String(next.notes) : "";
    changed = true;
  }
  if (!next.client_tx_id) {
    next.client_tx_id = makeClientTxId(next.worker_name, next.timestamp);
    changed = true;
  }
  if (!next.updated_at) {
    next.updated_at = normalizeIsoString(next.timestamp);
    changed = true;
  }

  return { next, changed };
};

const loadTx = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY_TRANSACTIONS) || "[]");
    let changed = false;
    const rows = parsed.map((tx) => {
      const normalized = normalizeTxRecord(tx);
      if (normalized.changed) changed = true;
      return normalized.next;
    });
    if (changed) {
      localStorage.setItem(KEY_TRANSACTIONS, JSON.stringify(rows));
    }
    return rows;
  } catch {
    return [];
  }
};
const saveTx = (data) => {
  try {
    localStorage.setItem(KEY_TRANSACTIONS, JSON.stringify(data));
  } catch {}
};

export const initDB = async () => {
  await openIDB();
};

// ─── Items ────────────────────────────────────────────────────────────────────

export const upsertItems = async (itemsArray) => {
  if (!itemsArray || itemsArray.length === 0) return;
  const db = await openIDB();
  _itemsCache = null; // invalidate cache so next read reflects new data
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, "readwrite");
    const store = tx.objectStore(ITEMS_STORE);
    for (const item of itemsArray) {
      store.put({
        barcode: item.Barcode,
        item_code: item.ItemCode,
        item_name: item.Item_Name,
      });
    }
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getItemByBarcode = async (barcode) => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(ITEMS_STORE, "readonly")
      .objectStore(ITEMS_STORE)
      .get(barcode);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getItemByItemCode = async (itemCode) => {
  const code = itemCode.trim().toLowerCase();
  const items = await getItemsCache();
  return items.find((i) => i.item_code.toLowerCase() === code) || null;
};

export const searchItemsByItemCode = async (query, limit = 50) => {
  const items = await getItemsCache();
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return [];

  const scoreItem = (itemCode) => {
    const code = String(itemCode || "").toLowerCase();
    if (code === q) return 0;
    if (code.endsWith(q)) return 1;
    if (code.includes(q)) return 2;
    return 3;
  };

  return items
    .filter((i) => scoreItem(i.item_code) < 3)
    .sort(
      (a, b) =>
        scoreItem(a.item_code) - scoreItem(b.item_code) ||
        String(a.item_code || "").length - String(b.item_code || "").length ||
        a.item_name.localeCompare(b.item_name),
    )
    .slice(0, limit);
};

export const searchItems = async (query) => {
  const items = await getItemsCache();
  const q = query.toLowerCase();
  const results = items.filter(
    (i) =>
      i.item_name.toLowerCase().includes(q) ||
      i.barcode.toLowerCase().includes(q) ||
      i.item_code.toLowerCase().includes(q),
  );
  return results.sort((a, b) => a.item_name.localeCompare(b.item_name));
};

export const searchItemsByName = async (query) => {
  const items = await getItemsCache();
  const q = query.toLowerCase();
  return items
    .filter((i) => i.item_name.toLowerCase().includes(q))
    .sort((a, b) => a.item_name.localeCompare(b.item_name));
};

export const getAllItems = async () => {
  const items = await getItemsCache();
  return [...items].sort((a, b) => a.item_name.localeCompare(b.item_name));
};

export const getItemCount = async () => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(ITEMS_STORE, "readonly")
      .objectStore(ITEMS_STORE)
      .count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const insertTransaction = async ({
  item_barcode,
  item_code = "",
  item_name,
  frombin,
  tobin,
  qty,
  worker_name = "unknown",
  notes = "",
}) => {
  const txs = loadTx();
  const id = txs.length > 0 ? Math.max(...txs.map((t) => t.id)) + 1 : 1;
  const timestamp = await getServerNow();
  let resolvedCode = item_code;
  if (!resolvedCode) {
    try {
      const found = await getItemByBarcode(item_barcode);
      if (found) resolvedCode = found.item_code || "";
    } catch {}
  }
  txs.push({
    id,
    item_barcode,
    item_code: resolvedCode,
    item_name,
    frombin,
    tobin,
    qty,
    timestamp,
    synced: 0,
    worker_name,
    notes,
    client_tx_id: makeClientTxId(worker_name, timestamp),
    updated_at: timestamp,
  });
  saveTx(txs);
  return id;
};

export const getPendingTransactions = async () => {
  return loadTx().filter((t) => t.synced === 0);
};

export const markTransactionsSynced = async (ids) => {
  saveTx(loadTx().map((t) => (ids.includes(t.id) ? { ...t, synced: 1 } : t)));
};

export const getRecentTransactions = async (limit = 20) => {
  const txs = loadTx()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
  // Backfill item_code for rows saved before this field existed
  const needsBackfill = txs.filter((t) => !t.item_code);
  if (needsBackfill.length > 0) {
    await Promise.all(
      needsBackfill.map(async (t) => {
        try {
          const found = await getItemByBarcode(t.item_barcode);
          if (found && found.item_code) t.item_code = found.item_code;
        } catch {}
      }),
    );
    const codeMap = {};
    txs.forEach((t) => {
      if (t.item_code) codeMap[t.id] = t.item_code;
    });
    saveTx(
      loadTx().map((t) =>
        codeMap[t.id] ? { ...t, item_code: codeMap[t.id] } : t,
      ),
    );
  }
  return txs;
};

export const updateTransaction = async (
  id,
  { frombin, tobin, qty, notes },
  _username,
  _role,
) => {
  const updatedAt = await getServerNow();
  saveTx(
    loadTx().map((t) =>
      t.id === id
        ? {
            ...t,
            frombin: frombin.trim(),
            tobin: tobin.trim(),
            qty: Number(qty),
            notes: (notes || "").trim(),
            synced: 0,
            updated_at: updatedAt,
          }
        : t,
    ),
  );
};

export const getAllTransactions = async () => {
  return loadTx().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

export const deleteTransaction = async (id, _username, _role) => {
  saveTx(loadTx().filter((t) => t.id !== id));
};

// ─── Admin: Clear / Reset ─────────────────────────────────────────────────────

export const clearSyncedTransactions = async () => {
  const all = loadTx();
  const kept = all.filter((t) => t.synced === 0);
  saveTx(kept);
  return all.length - kept.length;
};

export const clearAllTransactions = async () => {
  const count = loadTx().length;
  saveTx([]);
  return count;
};

export const restoreTransactions = async (
  rows,
  { replaceExisting = false } = {},
) => {
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const normalizedRows = (rows || []).map(normalizeRestoreTx).filter(Boolean);
  const existingRows = replaceExisting ? [] : loadTx();

  let inserted = 0;
  let updated = 0;
  const skipped = totalRows - normalizedRows.length;

  const nextRows = [...existingRows];

  normalizedRows.forEach((tx) => {
    const existingIndex = nextRows.findIndex(
      (row) =>
        row.client_tx_id === tx.client_tx_id ||
        (row.item_barcode === tx.item_barcode &&
          row.timestamp === tx.timestamp &&
          row.worker_name === tx.worker_name),
    );

    if (existingIndex >= 0) {
      nextRows[existingIndex] = {
        ...nextRows[existingIndex],
        ...tx,
        id: nextRows[existingIndex].id,
      };
      updated += 1;
      return;
    }

    const nextId =
      nextRows.length > 0
        ? Math.max(...nextRows.map((row) => row.id || 0)) + 1
        : 1;
    nextRows.push({ id: nextId, ...tx });
    inserted += 1;
  });

  saveTx(nextRows);

  return {
    total: normalizedRows.length,
    inserted,
    updated,
    skipped,
  };
};

export const clearAllItems = async () => {
  _itemsCache = null;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, "readwrite");
    tx.objectStore(ITEMS_STORE).clear();
    tx.oncomplete = () => {
      try {
        AsyncStorage.removeItem("itemsVersion");
      } catch (_) {}
      resolve(0);
    };
    tx.onerror = (e) => reject(e.target.error);
  });
};

// Atomic clear + replace: clears store and inserts all items in a single IndexedDB transaction.
// If anything fails, the entire transaction rolls back — local data stays untouched.
export const clearAndReplaceAllItems = async (itemsArray, onProgress) => {
  if (!itemsArray || itemsArray.length === 0) return 0;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, "readwrite");
    const store = tx.objectStore(ITEMS_STORE);
    store.clear();
    const total = itemsArray.length;
    for (let i = 0; i < total; i++) {
      const item = itemsArray[i];
      store.put({
        barcode: item.Barcode,
        item_code: item.ItemCode,
        item_name: item.Item_Name,
      });
      if (onProgress && (i % 5000 === 0 || i === total - 1)) {
        onProgress({ processed: i + 1, total });
      }
    }
    tx.oncomplete = () => {
      _itemsCache = null; // invalidate cache so next read reflects new data
      resolve(total);
    };
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getPendingCount = async () => {
  return loadTx().filter((t) => t.synced === 0).length;
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const getDashboardStats = async () => {
  const [totalItems, txs] = await Promise.all([
    getItemCount(),
    Promise.resolve(loadTx()),
  ]);
  return {
    totalItems,
    totalTransactions: txs.length,
    pendingSync: txs.filter((t) => t.synced === 0).length,
  };
};

// ─── Bin Contents (IndexedDB) ─────────────────────────────────────────────────
// In-memory cache for instant lookups — same pattern as items cache.
let _binCache = null;

const getBinCache = async () => {
  if (_binCache) return _binCache;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(BIN_CONTENTS_STORE, "readonly")
      .objectStore(BIN_CONTENTS_STORE)
      .getAll();
    req.onsuccess = () => {
      _binCache = req.result || [];
      resolve(_binCache);
    };
    req.onerror = (e) => reject(e.target.error);
  });
};

export const upsertBinContents = async (rows) => {
  if (!rows || rows.length === 0) return;
  _binCache = null;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIN_CONTENTS_STORE, "readwrite");
    const store = tx.objectStore(BIN_CONTENTS_STORE);
    for (const r of rows) {
      const bin_code = String(r.BinCode || r.bin_code || "").trim();
      const item_code = String(r.ItemCode || r.item_code || "").trim();
      const qty = Number(r.Qty != null ? r.Qty : r.qty) || 0;
      store.put({ _key: `${bin_code}|${item_code}`, bin_code, item_code, qty });
    }
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getBinsForItem = async (itemCode) => {
  const bins = await getBinCache();
  const masterCodes = await _getBinMasterCodes();
  const code = String(itemCode).trim();
  return bins
    .filter((b) => b.item_code === code && masterCodes.has(b.bin_code))
    .sort((a, b) => b.qty - a.qty);
};

// Helper: load all bin master codes as a Set for fast lookup
const _getBinMasterCodes = async () => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(BIN_MASTER_STORE, "readonly")
      .objectStore(BIN_MASTER_STORE)
      .getAll();
    req.onsuccess = () => resolve(new Set(req.result.map((r) => r.bin_code)));
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getBinQtyForItemAndBin = async (itemCode, binCode) => {
  const bins = await getBinCache();
  const code = String(itemCode).trim();
  const bin = String(binCode).trim().toUpperCase();
  const found = bins.find((b) => b.item_code === code && b.bin_code === bin);
  return found ? found.qty : null;
};

export const clearBinContents = async () => {
  _binCache = null;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIN_CONTENTS_STORE, "readwrite");
    tx.objectStore(BIN_CONTENTS_STORE).clear();
    tx.oncomplete = () => {
      try {
        AsyncStorage.removeItem("binContentVersion");
        AsyncStorage.removeItem("lastBinContentSyncTime");
      } catch (_) {}
      resolve(0);
    };
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const clearAndReplaceBinContents = async (rows, onProgress) => {
  if (!rows || rows.length === 0) {
    await clearBinContents();
    return 0;
  }
  _binCache = null;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIN_CONTENTS_STORE, "readwrite");
    const store = tx.objectStore(BIN_CONTENTS_STORE);
    store.clear();
    const total = rows.length;
    for (let i = 0; i < total; i++) {
      const r = rows[i];
      const bin_code = String(r.BinCode || r.bin_code || "").trim();
      const item_code = String(r.ItemCode || r.item_code || "").trim();
      const qty = Number(r.Qty != null ? r.Qty : r.qty) || 0;
      store.put({ _key: `${bin_code}|${item_code}`, bin_code, item_code, qty });
      if (onProgress && (i % 5000 === 0 || i === total - 1)) {
        onProgress({ processed: i + 1, total });
      }
    }
    tx.oncomplete = () => {
      _binCache = null;
      resolve(total);
    };
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getBinContentCount = async () => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(BIN_CONTENTS_STORE, "readonly")
      .objectStore(BIN_CONTENTS_STORE)
      .count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
};

// ─── Bin Master (hard-block validation) ──────────────────────────────────────

export const getBinMasterCount = async () => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(BIN_MASTER_STORE, "readonly")
      .objectStore(BIN_MASTER_STORE)
      .count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
};

export const checkBinExists = async (binCode) => {
  const db = await openIDB();
  const code = String(binCode).trim().toUpperCase();
  // Check bin_master first
  const masterExists = await new Promise((resolve, reject) => {
    const req = db
      .transaction(BIN_MASTER_STORE, "readonly")
      .objectStore(BIN_MASTER_STORE)
      .get(code);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = (e) => reject(e.target.error);
  });
  if (masterExists) return true;
  // Fallback: check bin_contents
  const bins = await getBinCache();
  return bins.some((b) => b.bin_code === code);
};

export const clearAndReplaceBinMaster = async (codes) => {
  if (!codes || codes.length === 0) return 0;
  const db = await openIDB();
  const total = codes.length;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIN_MASTER_STORE, "readwrite");
    const store = tx.objectStore(BIN_MASTER_STORE);
    store.clear();
    for (const c of codes) {
      store.put({ bin_code: String(c).trim().toUpperCase() });
    }
    tx.oncomplete = () => resolve(total);
    tx.onerror = (e) => reject(e.target.error);
  });
};

// ─── Item Summaries (grouped, for ItemsScreen) ────────────────────────────────

export const getItemSummaries = async (limit = 250, offset = 0) => {
  const items = await getItemsCache();
  // Group by item_code (or item_name when code is empty)
  const groups = new Map();
  for (const item of items) {
    const key = item.item_code
      ? item.item_code.trim().toLowerCase()
      : item.item_name.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        item_key: key,
        item_code: item.item_code || "",
        item_name: item.item_name || "",
        barcodeCount: 0,
      });
    }
    groups.get(key).barcodeCount += 1;
  }
  const sorted = [...groups.values()].sort((a, b) =>
    a.item_name.localeCompare(b.item_name),
  );
  return sorted.slice(offset, offset + limit);
};

export const searchItemSummaries = async (query, limit = 200) => {
  const items = await getItemsCache();
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return [];

  const groups = new Map();
  for (const item of items) {
    const nameMatch = item.item_name.toLowerCase().includes(q);
    const codeMatch = item.item_code.toLowerCase().includes(q);
    const barcodeMatch = item.barcode.toLowerCase().includes(q);
    if (!nameMatch && !codeMatch && !barcodeMatch) continue;

    const key = item.item_code
      ? item.item_code.trim().toLowerCase()
      : item.item_name.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        item_key: key,
        item_code: item.item_code || "",
        item_name: item.item_name || "",
        barcodeCount: 0,
      });
    }
    groups.get(key).barcodeCount += 1;
  }
  return [...groups.values()]
    .sort((a, b) => a.item_name.localeCompare(b.item_name))
    .slice(0, limit);
};

export const getItemBarcodes = async (itemCode, itemName) => {
  const items = await getItemsCache();
  const code = String(itemCode || "")
    .trim()
    .toLowerCase();
  if (code) {
    return items
      .filter((i) => i.item_code.toLowerCase() === code)
      .map((i) => i.barcode)
      .sort();
  }
  const name = String(itemName || "")
    .trim()
    .toLowerCase();
  return items
    .filter((i) => i.item_name.toLowerCase() === name)
    .map((i) => i.barcode)
    .sort();
};
