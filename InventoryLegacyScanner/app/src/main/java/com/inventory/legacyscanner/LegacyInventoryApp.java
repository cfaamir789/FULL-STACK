package com.inventory.legacyscanner;

import android.os.Build;
import android.util.Log;

import androidx.multidex.MultiDexApplication;

import com.inventory.legacyscanner.data.DbHelper;

public class LegacyInventoryApp extends MultiDexApplication {
    @Override
    public void onCreate() {
        super.onCreate();
        DbHelper.getInstance(this);
        installSecurityProvider();
    }

    /**
     * On Android 4.x, try to install the latest Google Play Services security provider.
     * This patches the system SSL stack to support TLS 1.2 even on old devices.
     * Fails silently if Play Services is not available.
     */
    private void installSecurityProvider() {
        if (Build.VERSION.SDK_INT >= 21) return;
        try {
            Class<?> providerInstaller = Class.forName("com.google.android.gms.security.ProviderInstaller");
            java.lang.reflect.Method install = providerInstaller.getMethod("installIfNeeded", android.content.Context.class);
            install.invoke(null, this);
            Log.i("LegacyApp", "Security provider updated for TLS 1.2");
        } catch (Exception e) {
            Log.w("LegacyApp", "ProviderInstaller not available, using custom TLS 1.2 factory: " + e.getMessage());
        }
    }
}
