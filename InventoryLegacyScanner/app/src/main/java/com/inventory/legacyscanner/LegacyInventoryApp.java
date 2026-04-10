package com.inventory.legacyscanner;

import android.os.Build;
import android.util.Log;

import androidx.multidex.MultiDexApplication;

import com.inventory.legacyscanner.data.DbHelper;
import com.inventory.legacyscanner.network.Tls12SocketFactory;

public class LegacyInventoryApp extends MultiDexApplication {
    @Override
    public void onCreate() {
        super.onCreate();

        // Install Conscrypt FIRST — before any code touches OkHttp or SSL.
        // This gives the JVM modern TLS 1.2 + modern cipher suites via BoringSSL.
        if (Build.VERSION.SDK_INT < 21) {
            Tls12SocketFactory.installConscrypt();
        }

        DbHelper.getInstance(this);
    }
}
