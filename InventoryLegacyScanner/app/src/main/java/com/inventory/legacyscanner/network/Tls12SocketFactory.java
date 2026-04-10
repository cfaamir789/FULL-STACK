package com.inventory.legacyscanner.network;

import android.os.Build;
import android.util.Log;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import okhttp3.ConnectionSpec;
import okhttp3.OkHttpClient;
import okhttp3.TlsVersion;

/**
 * Provides modern TLS on Android 4.x devices.
 * Stock Android 4.4 often supports the required ECDHE cipher suites but leaves
 * them disabled by default. We force TLS 1.2 and enable all supported suites.
 *
 * Conscrypt was removed from the startup path because some Huawei KitKat devices
 * abort the process while loading its native library, which cannot be recovered
 * in Java code.
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String TAG = "Tls12SF";
    private static final String[] TLS_V12 = {"TLSv1.2"};
    private static final String TLS_FALLBACK_SCSV = "TLS_FALLBACK_SCSV";
    private final SSLSocketFactory delegate;
    private static volatile String providerStatus = "system TLS only";

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
    }

    public static synchronized boolean installProvider() {
        providerStatus = "system TLS only";
        return false;
    }

    public static boolean isConscryptInstalled() {
        return false;
    }

    public static String getProviderStatus() {
        return providerStatus;
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return filterCipherSuites(delegate.getDefaultCipherSuites());
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return filterCipherSuites(delegate.getSupportedCipherSuites());
    }

    @Override
    public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
        return patch(delegate.createSocket(s, host, port, autoClose));
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
        return patch(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
        return patch(delegate.createSocket(host, port, localHost, localPort));
    }

    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        return patch(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
        return patch(delegate.createSocket(address, port, localAddress, localPort));
    }

    /**
     * Force TLS 1.2 and enable ALL supported cipher suites on every socket.
     * Even the stock Android 4.4 OpenSSL supports ECDHE ciphers but doesn't enable them.
     */
    private static Socket patch(Socket socket) {
        if (socket instanceof SSLSocket) {
            SSLSocket ssl = (SSLSocket) socket;
            ssl.setEnabledProtocols(TLS_V12);
            ssl.setEnabledCipherSuites(filterCipherSuites(ssl.getSupportedCipherSuites()));
        }
        return socket;
    }

    private static String[] filterCipherSuites(String[] suites) {
        java.util.List<String> filtered = new java.util.ArrayList<>();
        for (String suite : suites) {
            if (!TLS_FALLBACK_SCSV.equals(suite)) {
                filtered.add(suite);
            }
        }
        return filtered.toArray(new String[0]);
    }

    /**
     * Configure an OkHttpClient.Builder for TLS 1.2 on Android 4.x.
     * Uses the system SSL provider with all supported cipher suites enabled.
     * On API 21+ this is a no-op.
     */
    public static OkHttpClient.Builder apply(OkHttpClient.Builder builder) {
        if (Build.VERSION.SDK_INT >= 21) {
            return builder;
        }
        try {
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                    TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((java.security.KeyStore) null);
            TrustManager[] trustManagers = tmf.getTrustManagers();
            X509TrustManager tm = (X509TrustManager) trustManagers[0];

            SSLContext sc = SSLContext.getInstance("TLSv1.2");
            sc.init(null, new TrustManager[]{tm}, null);

            Tls12SocketFactory factory = new Tls12SocketFactory(sc.getSocketFactory());
            builder.sslSocketFactory(factory, tm);

            String[] ciphers = filterCipherSuites(sc.getSocketFactory().getSupportedCipherSuites());
            providerStatus = sc.getProvider().getName() + " " + ciphers.length + " ciphers";
            Log.i(TAG, "Provider=" + sc.getProvider().getName()
                    + " ciphers=" + ciphers.length);
            // Log ECDHE ciphers specifically (these are needed for Render/Cloudflare)
            for (String c : ciphers) {
                if (c.contains("ECDHE")) Log.d(TAG, "  " + c);
            }

            // Accept any TLS 1.2 cipher — let the server and client negotiate
            ConnectionSpec cs = new ConnectionSpec.Builder(true)
                    .tlsVersions(TlsVersion.TLS_1_2)
                    .allEnabledCipherSuites()
                    .supportsTlsExtensions(true)
                    .build();
            java.util.List<ConnectionSpec> specs = new java.util.ArrayList<>();
            specs.add(cs);
            builder.connectionSpecs(specs);
        } catch (Throwable e) {
            Log.e(TAG, "apply() failed completely: " + e.getMessage(), e);
        }
        return builder;
    }
}
