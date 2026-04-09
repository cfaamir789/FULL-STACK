package com.inventory.legacyscanner.data;

import android.content.Context;
import android.content.SharedPreferences;

import com.inventory.legacyscanner.config.AppConfig;
import com.inventory.legacyscanner.model.AuthSession;

public final class PrefsStore {
    private static final String PREFS_NAME = "legacy_inventory_prefs";
    private static final String KEY_SERVER = "server_address";
    private static final String KEY_TOKEN = "auth_token";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_ROLE = "role";
    private static final String KEY_ITEMS_VERSION = "items_version";
    private static final String KEY_LAST_SYNC = "last_sync";

    private PrefsStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void saveSession(Context context, AuthSession authSession) {
        prefs(context)
                .edit()
                .putString(KEY_TOKEN, authSession.token)
                .putString(KEY_USERNAME, authSession.username)
                .putString(KEY_ROLE, authSession.role)
                .putString(KEY_SERVER, authSession.serverAddress)
                .apply();
    }

    public static void clearSession(Context context) {
        prefs(context)
                .edit()
                .remove(KEY_TOKEN)
                .remove(KEY_USERNAME)
                .remove(KEY_ROLE)
                .apply();
    }

    public static String getServerAddress(Context context) {
        return prefs(context).getString(KEY_SERVER, AppConfig.DEFAULT_SERVER);
    }

    public static void setServerAddress(Context context, String serverAddress) {
        prefs(context).edit().putString(KEY_SERVER, serverAddress).apply();
    }

    public static String getToken(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }

    public static String getUsername(Context context) {
        return prefs(context).getString(KEY_USERNAME, "");
    }

    public static String getRole(Context context) {
        return prefs(context).getString(KEY_ROLE, "worker");
    }

    public static int getItemsVersion(Context context) {
        return prefs(context).getInt(KEY_ITEMS_VERSION, 0);
    }

    public static void setItemsVersion(Context context, int version) {
        prefs(context).edit().putInt(KEY_ITEMS_VERSION, version).apply();
    }

    public static String getLastSync(Context context) {
        return prefs(context).getString(KEY_LAST_SYNC, "");
    }

    public static void setLastSync(Context context, String lastSync) {
        prefs(context).edit().putString(KEY_LAST_SYNC, lastSync).apply();
    }
}
