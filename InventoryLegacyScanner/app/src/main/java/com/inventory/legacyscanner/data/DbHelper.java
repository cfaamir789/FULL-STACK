package com.inventory.legacyscanner.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.text.TextUtils;

import com.inventory.legacyscanner.model.ItemRecord;
import com.inventory.legacyscanner.model.TransactionRecord;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public class DbHelper extends SQLiteOpenHelper {
    private static final String DB_NAME = "legacy_inventory.db";
    private static final int DB_VERSION = 1;

    private static DbHelper instance;

    public static synchronized DbHelper getInstance(Context context) {
        if (instance == null) {
            instance = new DbHelper(context.getApplicationContext());
        }
        return instance;
    }

    private DbHelper(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS items (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "item_code TEXT NOT NULL," +
                "barcode TEXT NOT NULL UNIQUE," +
                "item_name TEXT NOT NULL)");

        db.execSQL("CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_items_item_code ON items(item_code)");

        db.execSQL("CREATE TABLE IF NOT EXISTS transactions (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "item_barcode TEXT NOT NULL," +
                "item_code TEXT NOT NULL DEFAULT ''," +
                "item_name TEXT NOT NULL," +
                "frombin TEXT NOT NULL," +
                "tobin TEXT NOT NULL," +
                "qty INTEGER NOT NULL," +
                "timestamp TEXT NOT NULL," +
                "synced INTEGER NOT NULL DEFAULT 0," +
                "worker_name TEXT NOT NULL DEFAULT 'unknown'," +
                "notes TEXT NOT NULL DEFAULT ''," +
                "client_tx_id TEXT NOT NULL DEFAULT ''," +
                "updated_at TEXT NOT NULL DEFAULT '')");

        db.execSQL("CREATE INDEX IF NOT EXISTS idx_transactions_synced ON transactions(synced)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_transactions_client_tx_id ON transactions(client_tx_id)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion == newVersion) {
            return;
        }
        db.execSQL("DROP TABLE IF EXISTS items");
        db.execSQL("DROP TABLE IF EXISTS transactions");
        onCreate(db);
    }

    public void replaceAllItems(List<ItemRecord> items) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("items", null, null);
            for (ItemRecord item : items) {
                ContentValues values = new ContentValues();
                values.put("item_code", item.itemCode);
                values.put("barcode", item.barcode);
                values.put("item_name", item.itemName);
                db.insertWithOnConflict("items", null, values, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public ItemRecord findItemByBarcode(String barcode) {
        Cursor cursor = getReadableDatabase().query(
                "items",
                new String[]{"item_code", "barcode", "item_name"},
                "barcode = ?",
                new String[]{barcode},
                null,
                null,
                null,
                "1"
        );
        try {
            if (cursor.moveToFirst()) {
                return new ItemRecord(
                        cursor.getString(0),
                        cursor.getString(1),
                        cursor.getString(2)
                );
            }
            return null;
        } finally {
            cursor.close();
        }
    }

    public long insertTransaction(TransactionRecord transactionRecord) {
        SQLiteDatabase db = getWritableDatabase();
        if (TextUtils.isEmpty(transactionRecord.timestamp)) {
            transactionRecord.timestamp = IsoClock.now();
        }
        if (TextUtils.isEmpty(transactionRecord.updatedAt)) {
            transactionRecord.updatedAt = transactionRecord.timestamp;
        }
        if (TextUtils.isEmpty(transactionRecord.clientTxId)) {
            transactionRecord.clientTxId = makeClientTxId(transactionRecord.workerName, transactionRecord.timestamp);
        }

        ContentValues values = new ContentValues();
        values.put("item_barcode", safe(transactionRecord.itemBarcode));
        values.put("item_code", safe(transactionRecord.itemCode));
        values.put("item_name", safe(transactionRecord.itemName));
        values.put("frombin", safe(transactionRecord.fromBin));
        values.put("tobin", safe(transactionRecord.toBin));
        values.put("qty", transactionRecord.qty);
        values.put("timestamp", transactionRecord.timestamp);
        values.put("synced", transactionRecord.synced);
        values.put("worker_name", safe(transactionRecord.workerName));
        values.put("notes", safe(transactionRecord.notes));
        values.put("client_tx_id", transactionRecord.clientTxId);
        values.put("updated_at", transactionRecord.updatedAt);
        return db.insert("transactions", null, values);
    }

    public List<TransactionRecord> getPendingTransactions() {
        return queryTransactions("SELECT * FROM transactions WHERE synced = 0 ORDER BY timestamp ASC");
    }

    public List<TransactionRecord> getRecentTransactions(int limit) {
        return queryTransactions("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT " + Math.max(1, limit));
    }

    public int getPendingCount() {
        return getCount("transactions", "synced = 0");
    }

    public int getItemCount() {
        return getCount("items", null);
    }

    public void markTransactionsSynced(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (Long id : ids) {
                ContentValues values = new ContentValues();
                values.put("synced", 1);
                db.update("transactions", values, "id = ?", new String[]{String.valueOf(id)});
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private List<TransactionRecord> queryTransactions(String sql) {
        List<TransactionRecord> records = new ArrayList<>();
        Cursor cursor = getReadableDatabase().rawQuery(sql, null);
        try {
            while (cursor.moveToNext()) {
                records.add(fromCursor(cursor));
            }
        } finally {
            cursor.close();
        }
        return records;
    }

    private int getCount(String table, String whereClause) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM ").append(table);
        if (!TextUtils.isEmpty(whereClause)) {
            sql.append(" WHERE ").append(whereClause);
        }

        Cursor cursor = getReadableDatabase().rawQuery(sql.toString(), null);
        try {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        } finally {
            cursor.close();
        }
    }

    private TransactionRecord fromCursor(Cursor cursor) {
        TransactionRecord record = new TransactionRecord();
        record.id = cursor.getLong(cursor.getColumnIndexOrThrow("id"));
        record.itemBarcode = cursor.getString(cursor.getColumnIndexOrThrow("item_barcode"));
        record.itemCode = cursor.getString(cursor.getColumnIndexOrThrow("item_code"));
        record.itemName = cursor.getString(cursor.getColumnIndexOrThrow("item_name"));
        record.fromBin = cursor.getString(cursor.getColumnIndexOrThrow("frombin"));
        record.toBin = cursor.getString(cursor.getColumnIndexOrThrow("tobin"));
        record.qty = cursor.getInt(cursor.getColumnIndexOrThrow("qty"));
        record.timestamp = cursor.getString(cursor.getColumnIndexOrThrow("timestamp"));
        record.synced = cursor.getInt(cursor.getColumnIndexOrThrow("synced"));
        record.workerName = cursor.getString(cursor.getColumnIndexOrThrow("worker_name"));
        record.notes = cursor.getString(cursor.getColumnIndexOrThrow("notes"));
        record.clientTxId = cursor.getString(cursor.getColumnIndexOrThrow("client_tx_id"));
        record.updatedAt = cursor.getString(cursor.getColumnIndexOrThrow("updated_at"));
        return record;
    }

    private String makeClientTxId(String workerName, String timestamp) {
        String safeWorker = safe(workerName).replaceAll("[^a-zA-Z0-9_-]", "_");
        long timePart = Math.max(0L, timestamp.hashCode());
        return String.format(Locale.US, "tx_%s_%s_%s", safeWorker, Long.toString(timePart, 36), UUID.randomUUID().toString().substring(0, 8));
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static final class IsoClock {
        private static final java.text.SimpleDateFormat ISO_FMT;
        static {
            ISO_FMT = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            ISO_FMT.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        }
        private IsoClock() {
        }

        private static String now() {
            return ISO_FMT.format(new java.util.Date());
        }
    }
}
