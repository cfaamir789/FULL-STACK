package com.inventory.legacyscanner;

import android.os.Build;
import android.util.Log;

import androidx.multidex.MultiDexApplication;

import com.inventory.legacyscanner.data.DbHelper;

public class LegacyInventoryApp extends MultiDexApplication {
    private static final String TAG = "LegacyApp";

    @Override
    public void onCreate() {
        super.onCreate();

        Log.i(TAG, "API " + Build.VERSION.SDK_INT + " startup");

        DbHelper.getInstance(this);
    }
}
