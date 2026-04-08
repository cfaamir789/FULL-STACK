/**
 * backupService.js
 * Handles local transaction backups to the phone's "InventoryManager" folder.
 * Works offline. Uses expo-file-system + expo-sharing.
 * Files are saved as CSV or XLSX with smart sequential naming.
 *
 * Filename pattern:
 *   {Username}_{DD-MM-YYYY}          ← first download of the day
 *   {Username}_{DD-MM-YYYY}_1        ← second
 *   {Username}_{DD-MM-YYYY}_2        ← third ...
 *   {Username}_{DD-MM-YYYY}-ENTIRE_DAY ← manual end-of-day backup
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Papa from "papaparse";

// ─── Folder ───────────────────────────────────────────────────────────────────
const BACKUP_DIR = FileSystem.documentDirectory + "InventoryManager/";

async function ensureBackupDir() {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
  }
}

// ─── Filename helpers ─────────────────────────────────────────────────────────
function todayString() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Counter key per user per day — stored in AsyncStorage */
const counterKey = (username, date) => `backupCounter_${username}_${date}`;

/** Returns next filename (no extension) and bumps the counter */
async function nextFilename(username, isEntireDay = false) {
  const date = todayString();
  const safe = (username || "backup").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (isEntireDay) {
    return `${safe}_${date}-ENTIRE_DAY`;
  }
  const key = counterKey(safe, date);
  const raw = await AsyncStorage.getItem(key);
  const n = raw ? parseInt(raw, 10) : 0;
  await AsyncStorage.setItem(key, String(n + 1));
  return n === 0 ? `${safe}_${date}` : `${safe}_${date}_${n}`;
}

// ─── CSV generation ───────────────────────────────────────────────────────────
function transactionsToCSV(transactions) {
  const rows = transactions.map((tx) => ({
    Worker: tx.worker_name || "",
    Date: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "",
    Barcode: tx.item_barcode || "",
    ItemCode: tx.item_code || "",
    ItemName: tx.item_name || "",
    From: tx.frombin || "",
    To: tx.tobin || "",
    Qty: tx.qty ?? "",
    Notes: tx.notes || "",
    Synced: tx.synced ? "Yes" : "No",
  }));
  return Papa.unparse(rows);
}

// ─── XLSX generation (SheetJS) ────────────────────────────────────────────────
let _XLSX = null;
async function getXLSX() {
  if (!_XLSX) {
    _XLSX = require("xlsx");
  }
  return _XLSX;
}

async function transactionsToXLSX(transactions) {
  const XLSX = await getXLSX();
  const rows = [
    [
      "Worker",
      "Date",
      "Barcode",
      "ItemCode",
      "ItemName",
      "From",
      "To",
      "Qty",
      "Notes",
      "Synced",
    ],
    ...transactions.map((tx) => [
      tx.worker_name || "",
      tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "",
      tx.item_barcode || "",
      tx.item_code || "",
      tx.item_name || "",
      tx.frombin || "",
      tx.tobin || "",
      tx.qty ?? "",
      tx.notes || "",
      tx.synced ? "Yes" : "No",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  // Return as base64 string
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

// ─── Save & Share ─────────────────────────────────────────────────────────────
/**
 * Main backup function.
 * @param {Array}  transactions - array from getAllTransactions()
 * @param {string} username     - logged-in user's name
 * @param {string} format       - "csv" | "xlsx"
 * @param {boolean} isEntireDay - true = ENTIRE_DAY suffix
 * @returns {Promise<{uri: string, filename: string}>}
 */
export async function saveBackup(
  transactions,
  username,
  format = "csv",
  isEntireDay = false,
) {
  await ensureBackupDir();
  const baseName = await nextFilename(username, isEntireDay);
  const ext = format === "xlsx" ? "xlsx" : "csv";
  const filename = `${baseName}.${ext}`;
  const fileUri = BACKUP_DIR + filename;

  if (format === "xlsx") {
    const base64 = await transactionsToXLSX(transactions);
    await FileSystem.writeAsStringAsync(fileUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else {
    const csv = transactionsToCSV(transactions);
    await FileSystem.writeAsStringAsync(fileUri, csv, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }

  return { uri: fileUri, filename };
}

/**
 * Save backup then immediately share/open it.
 */
export async function saveAndShareBackup(
  transactions,
  username,
  format = "csv",
  isEntireDay = false,
) {
  const { uri, filename } = await saveBackup(
    transactions,
    username,
    format,
    isEntireDay,
  );
  const mimeType =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv";
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle: `Save ${filename}`,
    });
  }
  return { uri, filename };
}

/**
 * Silent auto-backup — saves to InventoryManager folder without user prompt.
 * Call this on a 30-minute interval.
 */
export async function silentAutoBackup(transactions, username) {
  if (!transactions || transactions.length === 0) return null;
  try {
    const { uri, filename } = await saveBackup(
      transactions,
      username,
      "csv",
      false,
    );
    return { uri, filename };
  } catch (err) {
    console.warn("Auto-backup failed:", err.message);
    return null;
  }
}

/**
 * List all backup files saved so far.
 */
export async function listBackups() {
  try {
    await ensureBackupDir();
    const { exists } = await FileSystem.getInfoAsync(BACKUP_DIR);
    if (!exists) return [];
    return await FileSystem.readDirectoryAsync(BACKUP_DIR);
  } catch {
    return [];
  }
}
