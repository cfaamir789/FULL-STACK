package com.inventory.legacyscanner.ui;

import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.inventory.legacyscanner.R;
import com.inventory.legacyscanner.data.DbHelper;
import com.inventory.legacyscanner.data.PrefsStore;
import com.inventory.legacyscanner.model.ItemRecord;
import com.inventory.legacyscanner.model.TransactionRecord;
import com.inventory.legacyscanner.network.SyncManager;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class TransactionActivity extends AppCompatActivity {
    private EditText etBarcode, etItemCode, etItemName, etFromBin, etToBin, etQty, etNotes;
    private Button btnSubmit, btnLookup;
    private ProgressBar progressTx;
    private TextView tvTxStatus;

    private static final SimpleDateFormat ISO;

    static {
        ISO = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        ISO.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_transaction);

        etBarcode = findViewById(R.id.etBarcode);
        etItemCode = findViewById(R.id.etItemCode);
        etItemName = findViewById(R.id.etItemName);
        etFromBin = findViewById(R.id.etFromBin);
        etToBin = findViewById(R.id.etToBin);
        etQty = findViewById(R.id.etQty);
        etNotes = findViewById(R.id.etNotes);
        btnSubmit = findViewById(R.id.btnSubmit);
        btnLookup = findViewById(R.id.btnLookup);
        progressTx = findViewById(R.id.progressTx);
        tvTxStatus = findViewById(R.id.tvTxStatus);

        String barcode = getIntent().getStringExtra("barcode");
        if (!TextUtils.isEmpty(barcode)) {
            etBarcode.setText(barcode);
            lookupItem(barcode, null);
        }

        btnLookup.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String bc = etBarcode.getText().toString().trim();
                String ic = etItemCode.getText().toString().trim();
                if (!TextUtils.isEmpty(bc)) {
                    lookupItem(bc, null);
                } else if (!TextUtils.isEmpty(ic)) {
                    lookupItem(null, ic);
                } else {
                    tvTxStatus.setText("Enter barcode or item code first");
                }
            }
        });

        btnSubmit.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveTransaction();
            }
        });
    }

    private void lookupItem(String barcode, String itemCode) {
        ItemRecord item = null;
        if (!TextUtils.isEmpty(barcode)) {
            item = DbHelper.getInstance(this).findItemByBarcode(barcode);
        }
        if (item == null && !TextUtils.isEmpty(itemCode)) {
            item = DbHelper.getInstance(this).findItemByCode(itemCode);
        }
        if (item != null) {
            etBarcode.setText(item.barcode);
            etItemCode.setText(item.itemCode);
            etItemName.setText(item.itemName);
            tvTxStatus.setText("Item found — fill bins and qty");
        } else {
            tvTxStatus.setText("Item not found in local DB — fill manually");
        }
    }

    private void saveTransaction() {
        String barcode = etBarcode.getText().toString().trim();
        String itemCode = etItemCode.getText().toString().trim();
        String itemName = etItemName.getText().toString().trim();
        String fromBin = etFromBin.getText().toString().trim();
        String toBin = etToBin.getText().toString().trim();
        String qtyStr = etQty.getText().toString().trim();

        // Barcode is optional for manual entry; fall back to item code
        if (TextUtils.isEmpty(barcode)) {
            barcode = itemCode;
        }

        if (TextUtils.isEmpty(barcode) || TextUtils.isEmpty(itemName) ||
                TextUtils.isEmpty(fromBin) || TextUtils.isEmpty(toBin) || TextUtils.isEmpty(qtyStr)) {
            Toast.makeText(this, "Fill barcode/item code, item name, bins and qty", Toast.LENGTH_SHORT).show();
            return;
        }

        int qty;
        try {
            qty = Integer.parseInt(qtyStr);
        } catch (NumberFormatException e) {
            Toast.makeText(this, "Qty must be a number", Toast.LENGTH_SHORT).show();
            return;
        }

        TransactionRecord tx = new TransactionRecord();
        tx.itemBarcode = barcode;
        tx.itemCode = itemCode;
        tx.itemName = itemName;
        tx.fromBin = fromBin;
        tx.toBin = toBin;
        tx.qty = qty;
        tx.timestamp = ISO.format(new Date());
        tx.updatedAt = tx.timestamp;
        tx.synced = 0;
        tx.workerName = PrefsStore.getUsername(this);
        tx.notes = etNotes.getText().toString().trim();

        DbHelper.getInstance(this).insertTransaction(tx);
        Toast.makeText(this, "Transaction saved locally", Toast.LENGTH_SHORT).show();

        // Try immediate sync
        progressTx.setVisibility(View.VISIBLE);
        tvTxStatus.setText("Trying sync...");
        btnSubmit.setEnabled(false);

        SyncManager.syncNow(this, new SyncManager.SyncCallback() {
            @Override
            public void onResult(boolean success, int synced, String message) {
                progressTx.setVisibility(View.GONE);
                btnSubmit.setEnabled(true);
                if (success) {
                    tvTxStatus.setText("Synced! " + message);
                } else {
                    tvTxStatus.setText("Saved offline. " + message);
                }
                // Go back to main after short delay
                btnSubmit.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        finish();
                    }
                }, 1200);
            }
        });
    }
}
