package com.inventory.legacyscanner;

import androidx.multidex.MultiDexApplication;

import com.inventory.legacyscanner.data.DbHelper;

public class LegacyInventoryApp extends MultiDexApplication {
    @Override
    public void onCreate() {
        super.onCreate();
        DbHelper.getInstance(this);
    }
}
