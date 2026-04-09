package com.inventory.legacyscanner.ui;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.inventory.legacyscanner.R;
import com.inventory.legacyscanner.data.DbHelper;
import com.inventory.legacyscanner.data.PrefsStore;
import com.inventory.legacyscanner.model.ItemRecord;
import com.inventory.legacyscanner.model.TransactionRecord;
import com.inventory.legacyscanner.network.ApiClient;
import com.inventory.legacyscanner.network.SyncManager;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private static final int RC_CAMERA = 1001;
    private static final int RC_SCAN = 2001;

    private TextView tvWorker, tvServer, tvPendingCount, tvItemCount, tvLastSync, tvStatus;
    private Button btnScan, btnSync, btnRefreshItems, btnLogout;
    private ProgressBar progressMain;
    private LinearLayout recentList;
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable autoSyncRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvWorker = findViewById(R.id.tvWorker);
        tvServer = findViewById(R.id.tvServer);
        tvPendingCount = findViewById(R.id.tvPendingCount);
        tvItemCount = findViewById(R.id.tvItemCount);
        tvLastSync = findViewById(R.id.tvLastSync);
        tvStatus = findViewById(R.id.tvStatus);
        btnScan = findViewById(R.id.btnScan);
        btnSync = findViewById(R.id.btnSync);
        btnRefreshItems = findViewById(R.id.btnRefreshItems);
        btnLogout = findViewById(R.id.btnLogout);
        progressMain = findViewById(R.id.progressMain);
        recentList = findViewById(R.id.recentList);

        tvWorker.setText(PrefsStore.getUsername(this));
        tvServer.setText(PrefsStore.getServerAddress(this));

        btnScan.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openScanner();
            }
        });

        btnSync.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doSync();
            }
        });

        btnRefreshItems.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                refreshItemMaster();
            }
        });

        btnLogout.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                PrefsStore.clearSession(MainActivity.this);
                startActivity(new Intent(MainActivity.this, LoginActivity.class));
                finish();
            }
        });

        // Auto sync every 15 seconds
        autoSyncRunnable = new Runnable() {
            @Override
            public void run() {
                SyncManager.syncNow(MainActivity.this, new SyncManager.SyncCallback() {
                    @Override
                    public void onResult(boolean success, int synced, String message) {
                        refreshUI();
                    }
                });
                mainHandler.postDelayed(this, 15000);
            }
        };
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshUI();
        // Start auto sync with 2s delay
        mainHandler.postDelayed(autoSyncRunnable, 2000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        mainHandler.removeCallbacks(autoSyncRunnable);
    }

    private void openScanner() {
        if (Build.VERSION.SDK_INT >= 23 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, RC_CAMERA);
            return;
        }
        launchScan();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == RC_CAMERA && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            launchScan();
        } else {
            Toast.makeText(this, "Camera permission required for scanning", Toast.LENGTH_SHORT).show();
        }
    }

    private void launchScan() {
        Intent intent = new Intent(this, LegacyCaptureActivity.class);
        startActivityForResult(intent, RC_SCAN);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RC_SCAN && resultCode == RESULT_OK && data != null) {
            String barcode = data.getStringExtra("barcode");
            if (!TextUtils.isEmpty(barcode)) {
                openTransactionScreen(barcode);
            }
        }
    }

    private void openTransactionScreen(String barcode) {
        Intent intent = new Intent(this, TransactionActivity.class);
        intent.putExtra("barcode", barcode);
        startActivity(intent);
    }

    private void doSync() {
        progressMain.setVisibility(View.VISIBLE);
        tvStatus.setText("Syncing...");
        SyncManager.syncNow(this, new SyncManager.SyncCallback() {
            @Override
            public void onResult(boolean success, int synced, String message) {
                progressMain.setVisibility(View.GONE);
                tvStatus.setText(message);
                refreshUI();
            }
        });
    }

    private void refreshItemMaster() {
        progressMain.setVisibility(View.VISIBLE);
        tvStatus.setText("Downloading item master...");
        exec.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JsonObject data = ApiClient.fetchItemsBulk(MainActivity.this);
                    JsonArray itemsArr = data.has("items") ? data.getAsJsonArray("items") : new JsonArray();
                    List<ItemRecord> records = new ArrayList<>();
                    for (JsonElement el : itemsArr) {
                        records.add(ItemRecord.fromJson(el.getAsJsonObject()));
                    }
                    DbHelper.getInstance(MainActivity.this).replaceAllItems(records);
                    if (data.has("version")) {
                        PrefsStore.setItemsVersion(MainActivity.this, data.get("version").getAsInt());
                    }
                    final int count = records.size();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            progressMain.setVisibility(View.GONE);
                            tvStatus.setText("Downloaded " + count + " items");
                            refreshUI();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            progressMain.setVisibility(View.GONE);
                            tvStatus.setText("Failed: " + e.getMessage());
                        }
                    });
                }
            }
        });
    }

    private void refreshUI() {
        DbHelper db = DbHelper.getInstance(this);
        tvPendingCount.setText(String.valueOf(db.getPendingCount()));
        tvItemCount.setText(String.valueOf(db.getItemCount()));

        String lastSync = PrefsStore.getLastSync(this);
        if (TextUtils.isEmpty(lastSync)) {
            tvLastSync.setText("Last sync: never");
        } else {
            try {
                SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                Date d = iso.parse(lastSync);
                SimpleDateFormat local = new SimpleDateFormat("hh:mm a", Locale.US);
                tvLastSync.setText("Last sync: " + local.format(d));
            } catch (Exception e) {
                tvLastSync.setText("Last sync: " + lastSync);
            }
        }

        // Show recent transactions
        recentList.removeAllViews();
        List<TransactionRecord> recent = db.getRecentTransactions(10);
        LayoutInflater inflater = LayoutInflater.from(this);
        for (TransactionRecord tx : recent) {
            View row = inflater.inflate(R.layout.item_recent_transaction, recentList, false);
            TextView tvName = row.findViewById(R.id.tvItemName);
            TextView tvDetail = row.findViewById(R.id.tvDetail);
            TextView tvSyncStatus = row.findViewById(R.id.tvSyncStatus);

            tvName.setText(tx.itemName);
            tvDetail.setText(tx.fromBin + " → " + tx.toBin + " | Qty: " + tx.qty);
            if (tx.synced == 1) {
                tvSyncStatus.setText("✓ Synced");
                tvSyncStatus.setTextColor(ContextCompat.getColor(this, R.color.brand_secondary));
            } else {
                tvSyncStatus.setText("● Pending");
                tvSyncStatus.setTextColor(ContextCompat.getColor(this, R.color.brand_primary));
            }
            recentList.addView(row);
        }
    }
}
