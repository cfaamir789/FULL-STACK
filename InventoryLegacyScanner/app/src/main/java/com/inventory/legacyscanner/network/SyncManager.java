package com.inventory.legacyscanner.network;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.google.gson.JsonObject;
import com.inventory.legacyscanner.config.AppConfig;
import com.inventory.legacyscanner.data.DbHelper;
import com.inventory.legacyscanner.data.PrefsStore;
import com.inventory.legacyscanner.model.TransactionRecord;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SyncManager {
    public interface SyncCallback {
        void onResult(boolean success, int synced, String message);
    }

    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final SimpleDateFormat ISO;

    static {
        ISO = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        ISO.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private SyncManager() {
    }

    public static void syncNow(final Context ctx, final SyncCallback callback) {
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!NetworkUtils.isOnline(ctx)) {
                        postResult(callback, false, 0, "Offline");
                        return;
                    }
                    if (!ApiClient.healthCheck(ctx)) {
                        postResult(callback, false, 0, "Server unreachable");
                        return;
                    }
                    DbHelper db = DbHelper.getInstance(ctx);
                    List<TransactionRecord> pending = db.getPendingTransactions();
                    if (pending.isEmpty()) {
                        String now = ISO.format(new Date());
                        PrefsStore.setLastSync(ctx, now);
                        postResult(callback, true, 0, "Nothing to sync");
                        return;
                    }
                    int totalSynced = 0;
                    List<Long> syncedIds = new ArrayList<>();
                    for (int i = 0; i < pending.size(); i += AppConfig.SYNC_CHUNK_SIZE) {
                        int end = Math.min(i + AppConfig.SYNC_CHUNK_SIZE, pending.size());
                        List<TransactionRecord> chunk = pending.subList(i, end);
                        JsonObject result = ApiClient.syncTransactions(ctx, chunk);
                        int s = result.has("synced") ? result.get("synced").getAsInt() : chunk.size();
                        totalSynced += s;
                        for (TransactionRecord tx : chunk) {
                            syncedIds.add(tx.id);
                        }
                    }
                    db.markTransactionsSynced(syncedIds);
                    String now = ISO.format(new Date());
                    PrefsStore.setLastSync(ctx, now);
                    postResult(callback, true, totalSynced, "Synced " + totalSynced);
                } catch (Exception e) {
                    postResult(callback, false, 0, e.getMessage());
                }
            }
        });
    }

    private static void postResult(final SyncCallback cb, final boolean ok, final int count, final String msg) {
        if (cb == null) return;
        MAIN.post(new Runnable() {
            @Override
            public void run() {
                cb.onResult(ok, count, msg);
            }
        });
    }
}
