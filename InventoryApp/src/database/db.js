import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";

let db;

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
      synced       INTEGER NOT NULL DEFAULT 0,
      worker_name  TEXT NOT NULL DEFAULT 'unknown',
      notes        TEXT NOT NULL DEFAULT '',
      client_tx_id TEXT NOT NULL DEFAULT '',
      updated_at   TEXT NOT NULL DEFAULT ''
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

  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN client_tx_id TEXT NOT NULL DEFAULT ''`,
    );
  } catch (_) {
    // Column already exists — safe to ignore
  }

  // Create client_tx_id index AFTER the migration ensures the column exists
  try {
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_transactions_client_tx_id ON transactions(client_tx_id)`,
    );
  } catch (_) {
    // Index already exists — safe to ignore
  }

  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`,
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

  const missingClientIds = await db.getAllAsync(
    `SELECT id, timestamp, worker_name FROM transactions
     WHERE client_tx_id IS NULL OR client_tx_id = ''`,
  );
  for (const row of missingClientIds) {
    const timestamp = normalizeIsoString(row.timestamp);
    await db.runAsync(
      `UPDATE transactions
       SET client_tx_id = ?, updated_at = CASE
         WHEN updated_at IS NULL OR updated_at = '' THEN ?
         ELSE updated_at
       END
       WHERE id = ?`,
      [makeClientTxId(row.worker_name, timestamp), timestamp, row.id],
    );
  }

  await db.runAsync(
    `UPDATE transactions
     SET updated_at = timestamp
     WHERE updated_at IS NULL OR updated_at = ''`,
  );
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

export const searchItemsByItemCode = async (query, limit = 50) => {
  const normalized = String(query || "").trim();
  if (!normalized) return [];

  const suffix = `%${normalized}`;
  const contains = `%${normalized}%`;

  return await db.getAllAsync(
    `SELECT * FROM items
     WHERE item_code = ? OR item_code LIKE ? OR item_code LIKE ?
     ORDER BY
       CASE
         WHEN item_code = ? THEN 0
         WHEN item_code LIKE ? THEN 1
         WHEN item_code LIKE ? THEN 2
         ELSE 3
       END,
       LENGTH(item_code) ASC,
       item_name ASC
     LIMIT ?`,
    [normalized, suffix, contains, normalized, suffix, contains, limit],
  );
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
  const clientTxId = makeClientTxId(worker_name, timestamp);
  const result = await db.runAsync(
    `INSERT INTO transactions (
       item_barcode,
       item_code,
       item_name,
       frombin,
       tobin,
       qty,
       timestamp,
       synced,
       worker_name,
       notes,
       client_tx_id,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
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
      clientTxId,
      timestamp,
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
  const updatedAt = new Date().toISOString();
  await db.runAsync(
    `UPDATE transactions
     SET frombin = ?,
         tobin = ?,
         qty = ?,
         notes = ?,
         synced = 0,
         updated_at = ?
     WHERE id = ?`,
    [
      frombin.trim(),
      tobin.trim(),
      Number(qty),
      (notes || "").trim(),
      updatedAt,
      id,
    ],
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

export const restoreTransactions = async (
  rows,
  { replaceExisting = false } = {},
) => {
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const normalizedRows = (rows || []).map(normalizeRestoreTx).filter(Boolean);
  let inserted = 0;
  let updated = 0;
  const skipped = totalRows - normalizedRows.length;

  await db.withTransactionAsync(async () => {
    if (replaceExisting) {
      await db.runAsync("DELETE FROM transactions");
    }

    for (const tx of normalizedRows) {
      const existing = await db.getFirstAsync(
        `SELECT id FROM transactions
         WHERE client_tx_id = ?
            OR (
              item_barcode = ?
              AND timestamp = ?
              AND worker_name = ?
            )
         LIMIT 1`,
        [tx.client_tx_id, tx.item_barcode, tx.timestamp, tx.worker_name],
      );

      if (existing?.id) {
        await db.runAsync(
          `UPDATE transactions
           SET item_barcode = ?,
               item_code = ?,
               item_name = ?,
               frombin = ?,
               tobin = ?,
               qty = ?,
               timestamp = ?,
               synced = ?,
               worker_name = ?,
               notes = ?,
               client_tx_id = ?,
               updated_at = ?
           WHERE id = ?`,
          [
            tx.item_barcode,
            tx.item_code,
            tx.item_name,
            tx.frombin,
            tx.tobin,
            tx.qty,
            tx.timestamp,
            tx.synced,
            tx.worker_name,
            tx.notes,
            tx.client_tx_id,
            tx.updated_at,
            existing.id,
          ],
        );
        updated += 1;
        continue;
      }

      await db.runAsync(
        `INSERT INTO transactions (
           item_barcode,
           item_code,
           item_name,
           frombin,
           tobin,
           qty,
           timestamp,
           synced,
           worker_name,
           notes,
           client_tx_id,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.item_barcode,
          tx.item_code,
          tx.item_name,
          tx.frombin,
          tx.tobin,
          tx.qty,
          tx.timestamp,
          tx.synced,
          tx.worker_name,
          tx.notes,
          tx.client_tx_id,
          tx.updated_at,
        ],
      );
      inserted += 1;
    }
  });

  return {
    total: normalizedRows.length,
    inserted,
    updated,
    skipped,
  };
};

export const clearAllItems = async () => {
  const result = await db.runAsync("DELETE FROM items");
  // Reset items version so next sync re-downloads everything
  try {
    await AsyncStorage.removeItem("itemsVersion");
  } catch (_) {}
  return result.changes;
};

// Atomic clear + replace: downloads all items to memory first, then replaces in one transaction.
// If ANY chunk fails, the entire operation rolls back — local data stays untouched.
export const clearAndReplaceAllItems = async (itemsArray, onProgress) => {
  if (!itemsArray || itemsArray.length === 0) return 0;
  const CHUNK_SIZE = 300;
  const total = itemsArray.length;
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM items");
    for (let i = 0; i < total; i += CHUNK_SIZE) {
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
      if (onProgress)
        onProgress({ processed: Math.min(i + CHUNK_SIZE, total), total });
    }
  });
  return total;
};

export const getPendingCount = async () => {
  const row = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM transactions WHERE synced = 0",
  );
  return row?.count ?? 0;
};
