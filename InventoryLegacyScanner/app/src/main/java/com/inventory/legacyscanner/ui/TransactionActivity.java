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
    private Button btnSubmit;
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
        progressTx = findViewById(R.id.progressTx);
        tvTxStatus = findViewById(R.id.tvTxStatus);

        String barcode = getIntent().getStringExtra("barcode");
        if (!TextUtils.isEmpty(barcode)) {
            etBarcode.setText(barcode);
            lookupItem(barcode);
        }

        btnSubmit.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveTransaction();
            }
        });
    }

    private void lookupItem(String barcode) {
        ItemRecord item = DbHelper.getInstance(this).findItemByBarcode(barcode);
        if (item != null) {
            etItemCode.setText(item.itemCode);
            etItemName.setText(item.itemName);
        } else {
            etItemCode.setText("");
            etItemName.setText("");
            tvTxStatus.setText("Item not found locally — fill manually");
        }
    }

    private void saveTransaction() {
        String barcode = etBarcode.getText().toString().trim();
        String itemName = etItemName.getText().toString().trim();
        String fromBin = etFromBin.getText().toString().trim();
        String toBin = etToBin.getText().toString().trim();
        String qtyStr = etQty.getText().toString().trim();

        if (TextUtils.isEmpty(barcode) || TextUtils.isEmpty(itemName) ||
                TextUtils.isEmpty(fromBin) || TextUtils.isEmpty(toBin) || TextUtils.isEmpty(qtyStr)) {
            Toast.makeText(this, "Please fill all required fields", Toast.LENGTH_SHORT).show();
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
        tx.itemCode = etItemCode.getText().toString().trim();
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
