/**
 * Web-only database shim.
 * Metro automatically uses this file instead of db.js when bundling for web.
 * Uses localStorage so data persists across page refreshes.
 */

const KEY_ITEMS = 'inv_items';
const KEY_TRANSACTIONS = 'inv_transactions';

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
};
const save = (key, data) => {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
};
let _nextTxId = () => {
  const txs = load(KEY_TRANSACTIONS);
  return txs.length > 0 ? Math.max(...txs.map((t) => t.id)) + 1 : 1;
};

export const initDB = async () => {};

// ─── Items ────────────────────────────────────────────────────────────────────

export const upsertItems = async (itemsArray) => {
  if (!itemsArray || itemsArray.length === 0) return;
  const items = load(KEY_ITEMS);
  for (const item of itemsArray) {
    const idx = items.findIndex((i) => i.barcode === item.Barcode);
    const row = { id: idx >= 0 ? items[idx].id : Date.now() + Math.random(), item_code: item.ItemCode, barcode: item.Barcode, item_name: item.Item_Name };
    if (idx >= 0) items[idx] = row; else items.push(row);
  }
  save(KEY_ITEMS, items);
};

export const getItemByBarcode = async (barcode) => {
  return load(KEY_ITEMS).find((i) => i.barcode === barcode) || null;
};

export const searchItems = async (query) => {
  const q = query.toLowerCase();
  return load(KEY_ITEMS).filter((i) =>
    i.item_name.toLowerCase().includes(q) || i.barcode.toLowerCase().includes(q) || i.item_code.toLowerCase().includes(q)
  ).slice(0, 200);
};

export const getAllItems = async () => {
  return load(KEY_ITEMS).sort((a, b) => a.item_name.localeCompare(b.item_name)).slice(0, 1000);
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const insertTransaction = async ({ item_barcode, item_name, frombin, tobin, qty }) => {
  const txs = load(KEY_TRANSACTIONS);
  const id = _nextTxId();
  txs.push({ id, item_barcode, item_name, frombin, tobin, qty, timestamp: new Date().toISOString(), synced: 0 });
  save(KEY_TRANSACTIONS, txs);
  return id;
};

export const getPendingTransactions = async () => {
  return load(KEY_TRANSACTIONS).filter((t) => t.synced === 0);
};

export const markTransactionsSynced = async (ids) => {
  const txs = load(KEY_TRANSACTIONS).map((t) => ids.includes(t.id) ? { ...t, synced: 1 } : t);
  save(KEY_TRANSACTIONS, txs);
};

export const getRecentTransactions = async (limit = 20) => {
  return load(KEY_TRANSACTIONS).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const getDashboardStats = async () => {
  const items = load(KEY_ITEMS);
  const txs = load(KEY_TRANSACTIONS);
  return {
    totalItems: items.length,
    totalTransactions: txs.length,
    pendingSync: txs.filter((t) => t.synced === 0).length,
  };
};
