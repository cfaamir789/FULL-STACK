package com.inventory.legacyscanner.network;

import android.content.Context;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.inventory.legacyscanner.config.AppConfig;
import com.inventory.legacyscanner.data.PrefsStore;
import com.inventory.legacyscanner.model.AuthSession;
import com.inventory.legacyscanner.model.TransactionRecord;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class ApiClient {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final Gson GSON = new Gson();

    // Lazy-init clients so legacy TLS configuration is only created when networking is used.
    private static volatile OkHttpClient sClient;
    private static volatile OkHttpClient sBulkClient;
    private static volatile OkHttpClient sHealthClient;

    private static OkHttpClient getClient() {
        if (sClient == null) {
            synchronized (ApiClient.class) {
                if (sClient == null) {
                    sClient = Tls12SocketFactory.apply(new OkHttpClient.Builder()
                            .connectTimeout(15, TimeUnit.SECONDS)
                            .readTimeout(60, TimeUnit.SECONDS)
                            .writeTimeout(30, TimeUnit.SECONDS))
                            .build();
                }
            }
        }
        return sClient;
    }

    private static OkHttpClient getBulkClient() {
        if (sBulkClient == null) {
            synchronized (ApiClient.class) {
                if (sBulkClient == null) {
                    sBulkClient = Tls12SocketFactory.apply(new OkHttpClient.Builder()
                            .connectTimeout(20, TimeUnit.SECONDS)
                            .readTimeout(120, TimeUnit.SECONDS)
                            .writeTimeout(30, TimeUnit.SECONDS))
                            .build();
                }
            }
        }
        return sBulkClient;
    }

    private static OkHttpClient getHealthClient() {
        if (sHealthClient == null) {
            synchronized (ApiClient.class) {
                if (sHealthClient == null) {
                    sHealthClient = Tls12SocketFactory.apply(new OkHttpClient.Builder()
                            .connectTimeout(5, TimeUnit.SECONDS)
                            .readTimeout(5, TimeUnit.SECONDS))
                            .build();
                }
            }
        }
        return sHealthClient;
    }

    private ApiClient() {
    }

    private static String baseUrl(Context ctx) {
        String server = PrefsStore.getServerAddress(ctx);
        if (server == null || server.isEmpty()) {
            server = AppConfig.DEFAULT_SERVER;
        }
        return server.replaceAll("/+$", "") + "/api";
    }

    public static boolean healthCheck(Context ctx) {
        String[] servers = AppConfig.CLOUD_SERVERS;
        String saved = PrefsStore.getServerAddress(ctx);
        // Try saved server first, then fallbacks
        String[] tryOrder;
        if (saved != null && !saved.isEmpty()) {
            tryOrder = new String[servers.length + 1];
            tryOrder[0] = saved;
            System.arraycopy(servers, 0, tryOrder, 1, servers.length);
        } else {
            tryOrder = servers;
        }
        for (String server : tryOrder) {
            try {
                String url = server.replaceAll("/+$", "") + "/api/health";
                Request req = new Request.Builder().url(url).get().build();
                Response res = getHealthClient().newCall(req).execute();
                if (res.isSuccessful()) {
                    PrefsStore.setServerAddress(ctx, server);
                    res.close();
                    return true;
                }
                res.close();
            } catch (IOException ignored) {
            }
        }
        return false;
    }

    public static AuthSession login(Context ctx, String server, String username, String pin) throws IOException {
        String url = server.replaceAll("/+$", "") + "/api/auth/login";
        JsonObject body = new JsonObject();
        body.addProperty("username", username);
        body.addProperty("pin", pin);
        Request request = new Request.Builder()
                .url(url)
                .post(RequestBody.create(JSON, body.toString()))
                .build();
        Response response = getClient().newCall(request).execute();
        String responseBody = response.body() != null ? response.body().string() : "";
        if (!response.isSuccessful()) {
            JsonObject err = new JsonParser().parse(responseBody).getAsJsonObject();
            String msg = err.has("error") ? err.get("error").getAsString() : "Login failed";
            throw new IOException(msg);
        }
        JsonObject json = new JsonParser().parse(responseBody).getAsJsonObject();
        return new AuthSession(
                json.get("token").getAsString(),
                json.get("username").getAsString(),
                json.get("role").getAsString(),
                server
        );
    }

    public static JsonObject syncTransactions(Context ctx, List<TransactionRecord> transactions) throws IOException {
        String url = baseUrl(ctx) + "/sync";
        String token = PrefsStore.getToken(ctx);
        String worker = PrefsStore.getUsername(ctx);

        JsonArray arr = new JsonArray();
        for (TransactionRecord tx : transactions) {
            arr.add(tx.toSyncJson(worker));
        }
        JsonObject body = new JsonObject();
        body.add("transactions", arr);

        Request request = new Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer " + token)
                .post(RequestBody.create(JSON, body.toString()))
                .build();
        Response response = getClient().newCall(request).execute();
        String responseBody = response.body() != null ? response.body().string() : "{}";
        if (!response.isSuccessful()) {
            throw new IOException("Sync failed: " + response.code());
        }
        return new JsonParser().parse(responseBody).getAsJsonObject();
    }

    public static JsonObject fetchItemsBulk(Context ctx) throws IOException {
        String url = baseUrl(ctx) + "/items/bulk";
        String token = PrefsStore.getToken(ctx);
        Request request = new Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer " + token)
                .get()
                .build();
        IOException lastError = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                Response response = getBulkClient().newCall(request).execute();
                String responseBody = response.body() != null ? response.body().string() : "{}";
                if (!response.isSuccessful()) {
                    throw new IOException("Fetch items failed: " + response.code());
                }
                return new JsonParser().parse(responseBody).getAsJsonObject();
            } catch (IOException e) {
                lastError = e;
            }
        }
        throw lastError;
    }
}
