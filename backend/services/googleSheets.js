const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'config', 'google-credentials.json');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Transactions';

// Build an authenticated Sheets client from the service-account JSON key.
// Returns null (with a console warning) if credentials or Sheet ID are missing.
function getSheetsClient() {
  if (!SHEET_ID) {
    console.warn('[GoogleSheets] GOOGLE_SHEET_ID not set in .env — skipping Sheet append.');
    return null;
  }
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn('[GoogleSheets] google-credentials.json not found — skipping Sheet append.');
    return null;
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Append an array of transaction objects as new rows in the Google Sheet.
 * Each transaction must have: Item_Barcode, Item_Name, Frombin, Tobin, Qty, Timestamp, deviceId
 * Silently logs and returns on any failure so the phone sync is never broken.
 */
async function appendTransactions(transactions) {
  if (!transactions || transactions.length === 0) return;

  let sheets;
  try {
    sheets = getSheetsClient();
    if (!sheets) return;
  } catch (err) {
    console.error('[GoogleSheets] Auth error:', err.message);
    return;
  }

  const rows = transactions.map((tx) => {
    const ts = tx.Timestamp instanceof Date ? tx.Timestamp : new Date(tx.Timestamp);
    const date = ts.toLocaleDateString('en-GB'); // DD/MM/YYYY
    const time = ts.toLocaleTimeString('en-GB', { hour12: false }); // HH:MM:SS
    return [
      date,
      time,
      tx.Worker_Name || tx.deviceId || 'unknown',
      tx.Item_Barcode || '',
      tx.Item_Name || '',
      tx.Frombin || '',
      tx.Tobin || '',
      tx.Qty ?? '',
      new Date().toISOString(),   // Synced At (server time)
    ];
  });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:I`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
    console.log(`[GoogleSheets] Appended ${rows.length} row(s) to Sheet.`);
  } catch (err) {
    console.error('[GoogleSheets] Append failed:', err.message);
  }
}

module.exports = { appendTransactions };
