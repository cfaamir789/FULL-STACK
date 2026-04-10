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

        // Install Conscrypt FIRST — MUST happen before any class touches SSL/OkHttp.
        // On Android 4.x the system OpenSSL is too old (no modern cipher suites).
        // Conscrypt bundles BoringSSL which provides modern TLS on any API level.
        if (Build.VERSION.SDK_INT < 21) {
            Log.i(TAG, "Android API " + Build.VERSION.SDK_INT + " — installing Conscrypt");
            Tls12SocketFactory.installProvider();
            Log.i(TAG, "Conscrypt installed: " + Tls12SocketFactory.isConscryptInstalled());
        } else {
            Log.i(TAG, "Android API " + Build.VERSION.SDK_INT + " — system TLS is fine");
        }

        DbHelper.getInstance(this);
    }
}
