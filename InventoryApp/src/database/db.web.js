/**
 * Web-only database shim using IndexedDB (for items) + localStorage (for transactions).
 * IndexedDB supports large datasets and bulk inserts without size limits.
 */

// ─── IndexedDB for Items ──────────────────────────────────────────────────────

const IDB_NAME = 'inventory_db';
const IDB_VERSION = 1;
const ITEMS_STORE = 'items';
let _idb = null;

const openIDB = () => new Promise((resolve, reject) => {
  if (_idb) return resolve(_idb);
  const req = indexedDB.open(IDB_NAME, IDB_VERSION);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(ITEMS_STORE)) {
      db.createObjectStore(ITEMS_STORE, { keyPath: 'barcode' });
    }
  };
  req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
  req.onerror = (e) => reject(e.target.error);
});

// ─── localStorage for Transactions (small dataset) ───────────────────────────

const KEY_TRANSACTIONS = 'inv_transactions';
const loadTx = () => { try { return JSON.parse(localStorage.getItem(KEY_TRANSACTIONS) || '[]'); } catch { return []; } };
const saveTx = (data) => { try { localStorage.setItem(KEY_TRANSACTIONS, JSON.stringify(data)); } catch {} };

export const initDB = async () => { await openIDB(); };

// ─── Items ────────────────────────────────────────────────────────────────────

export const upsertItems = async (itemsArray) => {
  if (!itemsArray || itemsArray.length === 0) return;
  const db = await openIDB();
  // Bulk put in one IndexedDB transaction — very fast for large datasets
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(ITEMS_STORE);
    for (const item of itemsArray) {
      store.put({ barcode: item.Barcode, item_code: item.ItemCode, item_name: item.Item_Name });
    }
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getItemByBarcode = async (barcode) => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ITEMS_STORE, 'readonly').objectStore(ITEMS_STORE).get(barcode);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getItemByItemCode = async (itemCode) => {
  const db = await openIDB();
  const code = itemCode.trim();
  return new Promise((resolve, reject) => {
    const results = [];
    const req = db.transaction(ITEMS_STORE, 'readonly').objectStore(ITEMS_STORE).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.item_code === code) { resolve(cursor.value); return; }
        cursor.continue();
      } else {
        resolve(null);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
};

export const searchItems = async (query) => {
  const db = await openIDB();
  const q = query.toLowerCase();
  return new Promise((resolve, reject) => {
    const results = [];
    const req = db.transaction(ITEMS_STORE, 'readonly').objectStore(ITEMS_STORE).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && results.length < 200) {
        const { item_name, barcode, item_code } = cursor.value;
        if (item_name.toLowerCase().includes(q) || barcode.toLowerCase().includes(q) || item_code.toLowerCase().includes(q)) {
          results.push(cursor.value);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getAllItems = async () => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const results = [];
    const req = db.transaction(ITEMS_STORE, 'readonly').objectStore(ITEMS_STORE).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && results.length < 1000) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results.sort((a, b) => a.item_name.localeCompare(b.item_name)));
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getItemCount = async () => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ITEMS_STORE, 'readonly').objectStore(ITEMS_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const insertTransaction = async ({ item_barcode, item_name, frombin, tobin, qty }) => {
  const txs = loadTx();
  const id = txs.length > 0 ? Math.max(...txs.map((t) => t.id)) + 1 : 1;
  txs.push({ id, item_barcode, item_name, frombin, tobin, qty, timestamp: new Date().toISOString(), synced: 0 });
  saveTx(txs);
  return id;
};

export const getPendingTransactions = async () => {
  return loadTx().filter((t) => t.synced === 0);
};

export const markTransactionsSynced = async (ids) => {
  saveTx(loadTx().map((t) => ids.includes(t.id) ? { ...t, synced: 1 } : t));
};

export const getRecentTransactions = async (limit = 20) => {
  return loadTx().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const getDashboardStats = async () => {
  const [totalItems, txs] = await Promise.all([getItemCount(), Promise.resolve(loadTx())]);
  return {
    totalItems,
    totalTransactions: txs.length,
    pendingSync: txs.filter((t) => t.synced === 0).length,
  };
};
