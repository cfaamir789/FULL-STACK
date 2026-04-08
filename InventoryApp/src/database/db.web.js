/**
 * Web-only database shim using IndexedDB (for items) + localStorage (for transactions).
 * IndexedDB supports large datasets and bulk inserts without size limits.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

console.log('[DB] db.web.js loaded (web shim)');

// ─── IndexedDB for Items ──────────────────────────────────────────────────────

const IDB_NAME = "inventory_db";
const IDB_VERSION = 1;
const ITEMS_STORE = "items";
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
const loadTx = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY_TRANSACTIONS) || "[]");
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
    timestamp: new Date().toISOString(),
    synced: 0,
    worker_name,
    notes,
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

export const updateTransaction = async (id, { frombin, tobin, qty, notes }, _username, _role) => {
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

export const clearAllItems = async () => {
  _itemsCache = null;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, "readwrite");
    tx.objectStore(ITEMS_STORE).clear();
    tx.oncomplete = () => {
      try { AsyncStorage.removeItem("itemsVersion"); } catch (_) {}
      resolve(0);
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
