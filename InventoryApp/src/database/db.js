import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";

console.log('[DB] db.js loaded (native SQLite)');

let db;

export const initDB = async () => {
  db = await SQLite.openDatabaseAsync("inventory.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL,
      barcode   TEXT UNIQUE NOT NULL,
      item_name TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_item_code ON items(item_code);

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      item_barcode TEXT NOT NULL,
      item_code    TEXT NOT NULL DEFAULT '',
      item_name    TEXT NOT NULL,
      frombin      TEXT NOT NULL,
      tobin        TEXT NOT NULL,
      qty          INTEGER NOT NULL,
      timestamp    TEXT NOT NULL,
      synced       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_synced ON transactions(synced);
  `);

  // Migration 1: add item_code column if it doesn't exist yet (for existing DBs)
  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN item_code TEXT NOT NULL DEFAULT ''`,
    );
  } catch (_) {
    // Column already exists — safe to ignore
  }

  // Migration 3: add worker_name column to tag which worker did each transaction
  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN worker_name TEXT NOT NULL DEFAULT 'unknown'`,
    );
  } catch (_) {
    // Column already exists — safe to ignore
  }

  // Migration 4: add notes column for optional notes (damage, expiry, etc.)
  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN notes TEXT NOT NULL DEFAULT ''`,
    );
  } catch (_) {
    // Column already exists — safe to ignore
  }

  // Migration 2: backfill item_code for any transactions where it is still empty
  await db.execAsync(`
    UPDATE transactions
    SET item_code = (
      SELECT item_code FROM items
      WHERE items.barcode = transactions.item_barcode
      LIMIT 1
    )
    WHERE (item_code IS NULL OR item_code = '')
      AND EXISTS (
        SELECT 1 FROM items
        WHERE items.barcode = transactions.item_barcode
      )
  `);
};

// ─── Items ────────────────────────────────────────────────────────────────────

export const upsertItems = async (itemsArray) => {
  if (!itemsArray || itemsArray.length === 0) return;
  // 300 rows × 3 params = 900, safely under SQLite's 999 param limit
  const CHUNK_SIZE = 300;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < itemsArray.length; i += CHUNK_SIZE) {
      const chunk = itemsArray.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?,?,?)").join(",");
      const params = chunk.flatMap((item) => [
        item.ItemCode,
        item.Barcode,
        item.Item_Name,
      ]);
      await db.runAsync(
        `INSERT INTO items (item_code, barcode, item_name) VALUES ${placeholders}
         ON CONFLICT(barcode) DO UPDATE SET
           item_code = excluded.item_code,
           item_name = excluded.item_name`,
        params,
      );
    }
  });
};

export const getItemByBarcode = async (barcode) => {
  const row = await db.getFirstAsync(
    "SELECT * FROM items WHERE barcode = ? LIMIT 1",
    [barcode],
  );
  return row || null;
};

export const getItemByItemCode = async (itemCode) => {
  const row = await db.getFirstAsync(
    "SELECT * FROM items WHERE item_code = ? LIMIT 1",
    [itemCode.trim()],
  );
  return row || null;
};

export const searchItems = async (query) => {
  const q = `%${query}%`;
  return await db.getAllAsync(
    `SELECT * FROM items
     WHERE item_name LIKE ? OR barcode LIKE ? OR item_code LIKE ?
     ORDER BY item_name ASC
     LIMIT 200`,
    [q, q, q],
  );
};

export const getAllItems = async () => {
  return await db.getAllAsync(
    "SELECT * FROM items ORDER BY item_name ASC LIMIT 1000",
  );
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
  const timestamp = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO transactions (item_barcode, item_code, item_name, frombin, tobin, qty, timestamp, synced, worker_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      item_barcode,
      item_code,
      item_name,
      frombin,
      tobin,
      qty,
      timestamp,
      worker_name,
      notes,
    ],
  );
  return result.lastInsertRowId;
};

export const getPendingTransactions = async () => {
  return await db.getAllAsync(
    "SELECT * FROM transactions WHERE synced = 0 ORDER BY timestamp ASC",
  );
};

export const markTransactionsSynced = async (ids) => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE transactions SET synced = 1 WHERE id IN (${placeholders})`,
    ids,
  );
};

export const getRecentTransactions = async (limit = 20) => {
  return await db.getAllAsync(
    "SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?",
    [limit],
  );
};

export const getAllTransactions = async () => {
  return await db.getAllAsync(
    "SELECT * FROM transactions ORDER BY timestamp DESC",
  );
};

export const updateTransaction = async (
  id,
  { frombin, tobin, qty, notes },
  username,
  role,
) => {
  if (role !== "admin") {
    const tx = await db.getFirstAsync(
      "SELECT worker_name FROM transactions WHERE id = ?",
      [id],
    );
    if (tx && tx.worker_name !== username) {
      throw new Error("You can only edit your own transactions.");
    }
  }
  await db.runAsync(
    `UPDATE transactions SET frombin = ?, tobin = ?, qty = ?, notes = ?, synced = 0 WHERE id = ?`,
    [frombin.trim(), tobin.trim(), Number(qty), (notes || "").trim(), id],
  );
};

export const deleteTransaction = async (id, username, role) => {
  if (role !== "admin") {
    const tx = await db.getFirstAsync(
      "SELECT worker_name FROM transactions WHERE id = ?",
      [id],
    );
    if (tx && tx.worker_name !== username) {
      throw new Error("You can only delete your own transactions.");
    }
  }
  await db.runAsync("DELETE FROM transactions WHERE id = ?", [id]);
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const getDashboardStats = async () => {
  const [itemsRow, txRow, pendingRow] = await Promise.all([
    db.getFirstAsync("SELECT COUNT(*) as count FROM items"),
    db.getFirstAsync("SELECT COUNT(*) as count FROM transactions"),
    db.getFirstAsync(
      "SELECT COUNT(*) as count FROM transactions WHERE synced = 0",
    ),
  ]);
  return {
    totalItems: itemsRow?.count ?? 0,
    totalTransactions: txRow?.count ?? 0,
    pendingSync: pendingRow?.count ?? 0,
  };
};

// ─── Admin: Clear / Reset ─────────────────────────────────────────────────────

export const clearSyncedTransactions = async () => {
  const result = await db.runAsync("DELETE FROM transactions WHERE synced = 1");
  return result.changes;
};

export const clearAllTransactions = async () => {
  const result = await db.runAsync("DELETE FROM transactions");
  return result.changes;
};

export const clearAllItems = async () => {
  const result = await db.runAsync("DELETE FROM items");
  // Reset items version so next sync re-downloads everything
  try {
    await AsyncStorage.removeItem("itemsVersion");
  } catch (_) {}
  return result.changes;
};

export const getPendingCount = async () => {
  const row = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM transactions WHERE synced = 0",
  );
  return row?.count ?? 0;
};
