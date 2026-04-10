package com.inventory.legacyscanner;

import android.os.Build;
import android.util.Log;

import androidx.multidex.MultiDexApplication;

import com.inventory.legacyscanner.data.DbHelper;
import com.inventory.legacyscanner.network.Tls12SocketFactory;

public class LegacyInventoryApp extends MultiDexApplication {
    private static final String TAG = "LegacyApp";

    @Override
    public void onCreate() {
        super.onCreate();

        if (Build.VERSION.SDK_INT < 21) {
            boolean ok = Tls12SocketFactory.installProvider(this);
            Log.i(TAG, "TLS provider install: " + ok + " - " + Tls12SocketFactory.getProviderStatus());
        }

        Log.i(TAG, "API " + Build.VERSION.SDK_INT + " startup");

        DbHelper.getInstance(this);
    }
}
