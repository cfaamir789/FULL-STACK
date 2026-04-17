package com.inventory.legacyscanner.config;

public final class AppConfig {
    public static final String DEFAULT_SERVER = "https://fullstck-production.up.railway.app";
    public static final String FAILOVER_SERVER = "https://fullstck-production.up.railway.app";
    public static final String[] CLOUD_SERVERS = new String[]{DEFAULT_SERVER, FAILOVER_SERVER};
    public static final int SYNC_CHUNK_SIZE = 200;

    private AppConfig() {
    }
}
