package com.inventory.legacyscanner.ui;

import android.os.Bundle;
import android.text.InputFilter;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
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
    private boolean scanMode;
    private long editTxId = -1;

    private static final SimpleDateFormat ISO;
    static {
        ISO = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        ISO.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private static final InputFilter UPPERCASE_FILTER = new InputFilter.AllCaps();

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

        // Force uppercase on bin fields
        etFromBin.setFilters(new InputFilter[]{UPPERCASE_FILTER});
        etToBin.setFilters(new InputFilter[]{UPPERCASE_FILTER});

        // Check if editing an existing transaction
        editTxId = getIntent().getLongExtra("edit_tx_id", -1);
        if (editTxId > 0) {
            loadExistingTransaction(editTxId);
            btnSubmit.setText("Update Transaction");
        }

        String barcode = getIntent().getStringExtra("barcode");
        scanMode = !TextUtils.isEmpty(barcode);
        if (scanMode) {
            etBarcode.setText(barcode);
            lookupItem(barcode, null);
            etFromBin.requestFocus();
        }

        // Enter on barcode -> lookup + jump to From Bin
        etBarcode.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (isEnterAction(actionId, event)) {
                    String bc = etBarcode.getText().toString().trim();
                    if (!TextUtils.isEmpty(bc)) lookupItem(bc, null);
                    etFromBin.requestFocus();
                    return true;
                }
                return false;
            }
        });

        // Enter on item code -> lookup + jump to From Bin
        etItemCode.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (isEnterAction(actionId, event)) {
                    String ic = etItemCode.getText().toString().trim();
                    if (!TextUtils.isEmpty(ic)) lookupItem(null, ic);
                    etFromBin.requestFocus();
                    return true;
                }
                return false;
            }
        });

        // Enter on From Bin -> To Bin
        etFromBin.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (isEnterAction(actionId, event)) {
                    etToBin.requestFocus();
                    return true;
                }
                return false;
            }
        });

        // Enter on To Bin -> Qty
        etToBin.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (isEnterAction(actionId, event)) {
                    etQty.requestFocus();
                    etQty.selectAll();
                    return true;
                }
                return false;
            }
        });

        // Enter on Qty -> Save immediately
        etQty.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (isEnterAction(actionId, event)) {
                    saveTransaction();
                    return true;
                }
                return false;
            }
        });

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

    private boolean isEnterAction(int actionId, KeyEvent event) {
        return actionId == EditorInfo.IME_ACTION_NEXT
                || actionId == EditorInfo.IME_ACTION_DONE
                || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                    && event.getAction() == KeyEvent.ACTION_DOWN);
    }

    private void loadExistingTransaction(long txId) {
        TransactionRecord tx = DbHelper.getInstance(this).getTransactionById(txId);
        if (tx == null) return;
        etBarcode.setText(tx.itemBarcode);
        etItemCode.setText(tx.itemCode);
        etItemName.setText(tx.itemName);
        etFromBin.setText(tx.fromBin);
        etToBin.setText(tx.toBin);
        etQty.setText(String.valueOf(tx.qty));
        etNotes.setText(tx.notes);
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
        String fromBin = etFromBin.getText().toString().trim().toUpperCase(Locale.US);
        String toBin = etToBin.getText().toString().trim().toUpperCase(Locale.US);
        String qtyStr = etQty.getText().toString().trim();

        if (TextUtils.isEmpty(barcode)) barcode = itemCode;

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

        DbHelper db = DbHelper.getInstance(this);

        if (editTxId > 0) {
            db.updateTransaction(editTxId, barcode, itemCode, itemName, fromBin, toBin, qty,
                    etNotes.getText().toString().trim());
            Toast.makeText(this, "Updated: " + itemName, Toast.LENGTH_SHORT).show();
            SyncManager.syncNow(this, null);
            setResult(RESULT_OK);
            finish();
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

        db.insertTransaction(tx);
        Toast.makeText(this, "Saved: " + itemName + " x " + qty, Toast.LENGTH_SHORT).show();

        // Background sync
        SyncManager.syncNow(this, null);

        if (scanMode) {
            setResult(RESULT_OK);
            finish();
        } else {
            // Clear form for next entry
            etBarcode.setText("");
            etItemCode.setText("");
            etItemName.setText("");
            etFromBin.setText("");
            etToBin.setText("");
            etQty.setText("1");
            etNotes.setText("");
            tvTxStatus.setText("Saved! Enter next transaction.");
            etBarcode.requestFocus();
        }
    }
}
