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

        // On Android 4.x, try to install Conscrypt for modern TLS.
        // If it fails (e.g. native lib issue on some Huawei devices),
        // the app still works using system SSL with all ciphers enabled.
        if (Build.VERSION.SDK_INT < 21) {
            Log.i(TAG, "API " + Build.VERSION.SDK_INT + " — attempting Conscrypt");
            boolean ok = Tls12SocketFactory.installProvider();
            Log.i(TAG, "Conscrypt result: " + ok + " — " + Tls12SocketFactory.getProviderStatus());
        }

        DbHelper.getInstance(this);
    }
}
