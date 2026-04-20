import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAdminRole } from "../utils/roles";

let db;

// Yield to event loop — lets GC run between heavy batches, avoids ANR on low-RAM devices
const _yield = () => new Promise((r) => setTimeout(r, 0));

const ITEM_GROUP_EXPR =
  "LOWER(COALESCE(NULLIF(TRIM(item_code), ''), TRIM(item_name)))";

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

export const initDB = async () => {
  db = await SQLite.openDatabaseAsync("inventory.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL,
      barcode   TEXT UNIQUE NOT NULL,
      item_name TEXT NOT NULL,
      uom       TEXT NOT NULL DEFAULT 'PCS'
    );

    CREATE INDEX IF NOT EXISTS idx_items_item_code ON items(item_code);
    CREATE INDEX IF NOT EXISTS idx_items_item_name ON items(item_name);

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      item_barcode TEXT NOT NULL,
      item_code    TEXT NOT NULL DEFAULT '',
      item_name    TEXT NOT NULL,
      frombin      TEXT NOT NULL,
      tobin        TEXT NOT NULL,
      qty          INTEGER NOT NULL,
      uom          TEXT NOT NULL DEFAULT 'PCS',
      timestamp    TEXT NOT NULL,
      synced       INTEGER NOT NULL DEFAULT 0,
      worker_name  TEXT NOT NULL DEFAULT 'unknown',
      notes        TEXT NOT NULL DEFAULT '',
      client_tx_id TEXT NOT NULL DEFAULT '',
      updated_at   TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_synced ON transactions(synced);
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_worker_timestamp ON transactions(worker_name, timestamp DESC);
  `);

  // Migration 1: add item_code column if it doesn't exist yet (for existing DBs)
  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN item_code TEXT NOT NULL DEFAULT ''`,
    );
  } catch (_) {
    // Column already exists — safe to ignore
  }

  // Migration: add uom column to items if it doesn't exist yet
  try {
    await db.execAsync(
      `ALTER TABLE items ADD COLUMN uom TEXT NOT NULL DEFAULT 'PCS'`,
    );
  } catch (_) {}

  // Migration: add uom column to transactions if it doesn't exist yet
  try {
    await db.execAsync(
      `ALTER TABLE transactions ADD COLUMN uom TEXT NOT NULL DEFAULT 'PCS'`,
    );
  } catch (_) {}

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

  // Wrap backfill migrations in a single transaction for atomicity
  await db.withTransactionAsync(async () => {
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
  });

  // ─── Bin Contents table ─────────────────────────────────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS bin_contents (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      bin_code  TEXT NOT NULL,
      item_code TEXT NOT NULL,
      qty       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(bin_code, item_code)
    );
    CREATE INDEX IF NOT EXISTS idx_bin_contents_item_code ON bin_contents(item_code);
  `);

  // ─── Bin Master table (for hard-block bin validation) ───────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS bin_master (
      bin_code TEXT PRIMARY KEY
    );
  `);
};

// ─── Items ────────────────────────────────────────────────────────────────────

export const upsertItems = async (itemsArray) => {
  if (!itemsArray || itemsArray.length === 0) return;
  const ROWS_PER_INSERT = 200;
  const ROWS_PER_TX = 2000;
  const total = itemsArray.length;
  for (let bStart = 0; bStart < total; bStart += ROWS_PER_TX) {
    const bEnd = Math.min(bStart + ROWS_PER_TX, total);
    await db.withTransactionAsync(async () => {
      for (let i = bStart; i < bEnd; i += ROWS_PER_INSERT) {
        const chunk = itemsArray.slice(i, Math.min(i + ROWS_PER_INSERT, bEnd));
        const valid = chunk.filter(
          (item) => item.Barcode && String(item.Barcode).trim(),
        );
        if (valid.length === 0) continue;
        const placeholders = valid.map(() => "(?,?,?)").join(",");
        const params = valid.flatMap((item) => [
          item.ItemCode || "",
          String(item.Barcode).trim(),
          item.Item_Name || "",
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
    await _yield();
  }
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

export const searchItemsByName = async (query, limit = 200) => {
  const q = `%${query}%`;
  return await db.getAllAsync(
    `SELECT * FROM items WHERE item_name LIKE ? ORDER BY item_name ASC LIMIT ?`,
    [q, limit],
  );
};

const mapItemSummary = (row) => ({
  item_key: row.item_key,
  item_code: String(row.item_code || "").trim(),
  item_name: row.item_name,
  barcodeCount: Number(row.barcode_count || 0),
});

export const getItemSummaries = async (limit = 250, offset = 0) => {
  const rows = await db.getAllAsync(
    `SELECT
       ${ITEM_GROUP_EXPR} AS item_key,
       TRIM(COALESCE(item_code, '')) AS item_code,
       MIN(item_name) AS item_name,
       COUNT(*) AS barcode_count
     FROM items
     GROUP BY ${ITEM_GROUP_EXPR}, TRIM(COALESCE(item_code, ''))
     ORDER BY item_name COLLATE NOCASE ASC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map(mapItemSummary);
};

export const searchItemSummaries = async (query, limit = 200) => {
  const q = `%${String(query || "").trim()}%`;
  const rows = await db.getAllAsync(
    `SELECT
       ${ITEM_GROUP_EXPR} AS item_key,
       TRIM(COALESCE(item_code, '')) AS item_code,
       MIN(item_name) AS item_name,
       COUNT(*) AS barcode_count
     FROM items
     WHERE item_name LIKE ? OR barcode LIKE ? OR item_code LIKE ?
     GROUP BY ${ITEM_GROUP_EXPR}, TRIM(COALESCE(item_code, ''))
     ORDER BY item_name COLLATE NOCASE ASC
     LIMIT ?`,
    [q, q, q, limit],
  );
  return rows.map(mapItemSummary);
};

export const getItemBarcodes = async (itemCode, itemName, limit = 5000) => {
  const normalizedCode = String(itemCode || "").trim();
  if (normalizedCode) {
    const rows = await db.getAllAsync(
      `SELECT barcode
       FROM items
       WHERE TRIM(item_code) = ?
       ORDER BY barcode ASC
       LIMIT ?`,
      [normalizedCode, limit],
    );
    return rows.map((row) => row.barcode);
  }

  const normalizedName = String(itemName || "").trim();
  const rows = await db.getAllAsync(
    `SELECT barcode
     FROM items
     WHERE TRIM(item_name) = ?
     ORDER BY barcode ASC
     LIMIT ?`,
    [normalizedName, limit],
  );
  return rows.map((row) => row.barcode);
};

export const getAllItems = async () => {
  return await db.getAllAsync(
    "SELECT * FROM items ORDER BY item_name ASC LIMIT 50000",
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
  uom = "PCS",
  worker_name = "unknown",
  notes = "",
}) => {
  const timestamp = await getServerNow();
  const clientTxId = makeClientTxId(worker_name, timestamp);
  const result = await db.runAsync(
    `INSERT INTO transactions (
       item_barcode,
       item_code,
       item_name,
       frombin,
       tobin,
       qty,
       uom,
       timestamp,
       synced,
       worker_name,
       notes,
       client_tx_id,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      item_barcode,
      item_code,
      item_name,
      frombin,
      tobin,
      qty,
      uom,
      timestamp,
      worker_name,
      notes,
      clientTxId,
      timestamp,
    ],
  );
  return result.lastInsertRowId;
};

export const getPendingTransactions = async (workerName = "") => {
  const normalizedWorker = String(workerName || "").trim();
  if (normalizedWorker) {
    return await db.getAllAsync(
      `SELECT *
       FROM transactions
       WHERE synced = 0 AND worker_name = ?
       ORDER BY timestamp ASC`,
      [normalizedWorker],
    );
  }

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

export const getTransactionsPage = async (
  limit = 100,
  offset = 0,
  workerName = "",
) => {
  const normalizedWorker = String(workerName || "").trim();
  if (normalizedWorker) {
    return await db.getAllAsync(
      `SELECT *
       FROM transactions
       WHERE worker_name = ?
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [normalizedWorker, limit, offset],
    );
  }

  return await db.getAllAsync(
    `SELECT *
     FROM transactions
     ORDER BY timestamp DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
};

export const getTransactionsCount = async (workerName = "") => {
  const normalizedWorker = String(workerName || "").trim();
  if (normalizedWorker) {
    const row = await db.getFirstAsync(
      `SELECT COUNT(*) AS count
       FROM transactions
       WHERE worker_name = ?`,
      [normalizedWorker],
    );
    return Number(row?.count || 0);
  }

  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS count
     FROM transactions`,
  );
  return Number(row?.count || 0);
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
  if (!isAdminRole(role)) {
    const tx = await db.getFirstAsync(
      "SELECT worker_name FROM transactions WHERE id = ?",
      [id],
    );
    if (tx && tx.worker_name !== username) {
      throw new Error("You can only edit your own transactions.");
    }
  }
  const updatedAt = await getServerNow();
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
  if (!isAdminRole(role)) {
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

// Delete all items (DB only, no AsyncStorage). Used as step 1 of paginated download.
export const deleteAllItemRows = async () => {
  await db.runAsync("DELETE FROM items");
};

// Insert one page of items. Called repeatedly during paginated download.
// Each call is a single small transaction — memory-safe on low-RAM devices.
export const insertItemsPage = async (items) => {
  if (!items || items.length === 0) return 0;
  const ROWS_PER_INSERT = 200;
  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < items.length; i += ROWS_PER_INSERT) {
      const chunk = items.slice(i, i + ROWS_PER_INSERT);
      const valid = chunk.filter(
        (item) => item.Barcode && String(item.Barcode).trim(),
      );
      if (valid.length === 0) continue;
      const placeholders = valid.map(() => "(?,?,?)").join(",");
      const params = valid.flatMap((item) => [
        item.ItemCode || "",
        String(item.Barcode).trim(),
        item.Item_Name || "",
      ]);
      await db.runAsync(
        `INSERT INTO items (item_code, barcode, item_name) VALUES ${placeholders}
         ON CONFLICT(barcode) DO UPDATE SET
           item_code = excluded.item_code,
           item_name = excluded.item_name`,
        params,
      );
      inserted += valid.length;
    }
  });
  await _yield();
  return inserted;
};

// Clear + replace in small batched transactions to avoid OOM on low-RAM devices.
// Each batch commits independently — keeps WAL journal small and lets GC reclaim memory.
// If the app crashes mid-way, a re-download will complete the replacement.
export const clearAndReplaceAllItems = async (itemsArray, onProgress) => {
  if (!itemsArray || itemsArray.length === 0) return 0;
  const ROWS_PER_INSERT = 200; // params per INSERT (200×3 = 600, well under 999)
  const ROWS_PER_TX = 2000; // rows per transaction — keeps WAL journal small
  const total = itemsArray.length;

  // 1. Delete all items (fast, separate transaction)
  await db.runAsync("DELETE FROM items");

  // 2. Insert in small batched transactions
  let inserted = 0;
  for (let bStart = 0; bStart < total; bStart += ROWS_PER_TX) {
    const bEnd = Math.min(bStart + ROWS_PER_TX, total);
    await db.withTransactionAsync(async () => {
      for (let i = bStart; i < bEnd; i += ROWS_PER_INSERT) {
        const chunk = itemsArray.slice(i, Math.min(i + ROWS_PER_INSERT, bEnd));
        // Skip items with missing barcode (NOT NULL constraint)
        const valid = chunk.filter(
          (item) => item.Barcode && String(item.Barcode).trim(),
        );
        if (valid.length === 0) continue;
        const placeholders = valid.map(() => "(?,?,?)").join(",");
        const params = valid.flatMap((item) => [
          item.ItemCode || "",
          String(item.Barcode).trim(),
          item.Item_Name || "",
        ]);
        await db.runAsync(
          `INSERT INTO items (item_code, barcode, item_name) VALUES ${placeholders}
           ON CONFLICT(barcode) DO UPDATE SET
             item_code = excluded.item_code,
             item_name = excluded.item_name`,
          params,
        );
        inserted += valid.length;
      }
    });
    // Yield to event loop between batches — lets GC reclaim + avoids ANR
    await _yield();
    if (onProgress) onProgress({ processed: bEnd, total });
  }
  return inserted;
};

export const getPendingCount = async () => {
  const row = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM transactions WHERE synced = 0",
  );
  return row?.count ?? 0;
};

// ─── Bin Contents ─────────────────────────────────────────────────────────────

export const upsertBinContents = async (rows) => {
  if (!rows || rows.length === 0) return;
  // 3 params per row, chunk at 300 rows (900 params < 999 SQLite limit)
  const CHUNK_SIZE = 300;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?,?,?)").join(",");
      const params = chunk.flatMap((r) => [
        String(r.BinCode || r.bin_code || "").trim(),
        String(r.ItemCode || r.item_code || "").trim(),
        Number(r.Qty != null ? r.Qty : r.qty) || 0,
      ]);
      await db.runAsync(
        `INSERT INTO bin_contents (bin_code, item_code, qty) VALUES ${placeholders}
         ON CONFLICT(bin_code, item_code) DO UPDATE SET qty = excluded.qty`,
        params,
      );
    }
  });
};

export const getBinsForItem = async (itemCode) => {
  const rows = await db.getAllAsync(
    `SELECT bc.bin_code, bc.qty FROM bin_contents bc
     INNER JOIN bin_master bm ON bm.bin_code = bc.bin_code
     WHERE bc.item_code = ?
     ORDER BY bc.qty DESC`,
    [String(itemCode).trim()],
  );
  return rows;
};

export const getBinQtyForItemAndBin = async (itemCode, binCode) => {
  const row = await db.getFirstAsync(
    `SELECT qty FROM bin_contents WHERE item_code = ? AND bin_code = ? LIMIT 1`,
    [String(itemCode).trim(), String(binCode).trim().toUpperCase()],
  );
  return row ? row.qty : null;
};

export const clearBinContents = async () => {
  const result = await db.runAsync("DELETE FROM bin_contents");
  try {
    await AsyncStorage.removeItem("binContentVersion");
    await AsyncStorage.removeItem("lastBinContentSyncTime");
  } catch (_) {}
  return result.changes;
};

export const clearAndReplaceBinContents = async (rows, onProgress) => {
  if (!rows || rows.length === 0) {
    await db.runAsync("DELETE FROM bin_contents");
    return 0;
  }
  const CHUNK_SIZE = 300;
  const total = rows.length;
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM bin_contents");
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?,?,?)").join(",");
      const params = chunk.flatMap((r) => [
        String(r.BinCode || r.bin_code || "").trim(),
        String(r.ItemCode || r.item_code || "").trim(),
        Number(r.Qty != null ? r.Qty : r.qty) || 0,
      ]);
      await db.runAsync(
        `INSERT INTO bin_contents (bin_code, item_code, qty) VALUES ${placeholders}`,
        params,
      );
      if (onProgress)
        onProgress({ processed: Math.min(i + CHUNK_SIZE, total), total });
    }
  });
  return total;
};

export const getBinContentCount = async () => {
  const row = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM bin_contents",
  );
  return row?.count ?? 0;
};

// ─── Bin Master (hard-block validation) ──────────────────────────────────────

export const getBinMasterCount = async () => {
  const row = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM bin_master",
  );
  return row?.count ?? 0;
};

export const checkBinExists = async (binCode) => {
  const code = String(binCode).trim().toUpperCase();
  const row = await db.getFirstAsync(
    `SELECT 1 FROM bin_master WHERE bin_code = ?
     UNION
     SELECT 1 FROM bin_contents WHERE bin_code = ?
     LIMIT 1`,
    [code, code],
  );
  return !!row;
};

export const clearAndReplaceBinMaster = async (codes) => {
  if (!codes || codes.length === 0) return 0;
  const CHUNK_SIZE = 500;
  const total = codes.length;
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM bin_master");
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = codes.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?)").join(",");
      await db.runAsync(
        `INSERT OR IGNORE INTO bin_master (bin_code) VALUES ${placeholders}`,
        chunk.map((c) => String(c).trim().toUpperCase()),
      );
    }
  });
  return total;
};
