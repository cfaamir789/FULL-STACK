package com.inventory.legacyscanner.network;

import android.os.Build;
import android.util.Log;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.Provider;
import java.security.Security;

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
 * Strategy:
 *   1. Try to load bundled Conscrypt via reflection (BoringSSL with modern ciphers).
 *   2. If Conscrypt fails (native lib crash on some Huawei devices), fall back to
 *      the system SSLContext but enable ALL supported cipher suites — stock Android 4.4
 *      has ECDHE ciphers available but disabled by default.
 *
 * Conscrypt is loaded via REFLECTION so that if its native library fails,
 * no class-loading error propagates to this class or the Application.
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String TAG = "Tls12SF";
    private static final String[] TLS_V12 = {"TLSv1.2"};
    private final SSLSocketFactory delegate;
    private static volatile boolean conscryptInstalled = false;
    private static volatile String providerStatus = "not attempted";

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
    }

    /**
     * Try to install Conscrypt via reflection. Never references org.conscrypt directly.
     * If the native library fails to load, this method logs the error and returns false.
     */
    public static synchronized boolean installProvider() {
        if (conscryptInstalled) return true;
        try {
            // Load Conscrypt via reflection — isolates native lib crashes
            Class<?> conscryptClass = Class.forName("org.conscrypt.Conscrypt");
            java.lang.reflect.Method newProvider = conscryptClass.getMethod("newProvider");
            Provider provider = (Provider) newProvider.invoke(null);
            int pos = Security.insertProviderAt(provider, 1);
            conscryptInstalled = true;
            providerStatus = "Conscrypt at #" + pos;
            Log.i(TAG, "Conscrypt installed at position " + pos);

            // Verify
            SSLContext test = SSLContext.getInstance("TLSv1.2", provider);
            String[] ciphers = test.getSocketFactory().getSupportedCipherSuites();
            Log.i(TAG, "Conscrypt ciphers: " + ciphers.length);
            providerStatus += ", " + ciphers.length + " ciphers";
            return true;
        } catch (Throwable e) {
            // Catches UnsatisfiedLinkError, ExceptionInInitializerError, ClassNotFoundException,
            // NoClassDefFoundError, etc.
            providerStatus = "FAILED: " + e.getClass().getSimpleName() + ": " + e.getMessage();
            Log.e(TAG, "Conscrypt failed: " + providerStatus, e);
            return false;
        }
    }

    public static boolean isConscryptInstalled() {
        return conscryptInstalled;
    }

    public static String getProviderStatus() {
        return providerStatus;
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return delegate.getDefaultCipherSuites();
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return delegate.getSupportedCipherSuites();
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
            ssl.setEnabledCipherSuites(ssl.getSupportedCipherSuites());
        }
        return socket;
    }

    /**
     * Configure an OkHttpClient.Builder for TLS 1.2 on Android 4.x.
     * Uses Conscrypt if available, otherwise falls back to system SSL with all ciphers enabled.
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

            SSLContext sc;
            if (conscryptInstalled) {
                // Use Conscrypt's BoringSSL — modern ciphers guaranteed
                try {
                    Provider conscrypt = Security.getProvider("Conscrypt");
                    if (conscrypt != null) {
                        sc = SSLContext.getInstance("TLSv1.2", conscrypt);
                        Log.i(TAG, "apply(): Conscrypt SSLContext OK");
                    } else {
                        sc = SSLContext.getInstance("TLSv1.2");
                        Log.w(TAG, "apply(): Conscrypt flag set but provider not found");
                    }
                } catch (Throwable e) {
                    sc = SSLContext.getInstance("TLSv1.2");
                    Log.w(TAG, "apply(): Conscrypt SSLContext failed, using system: " + e.getMessage());
                }
            } else {
                // Fallback: system SSL + we'll enable all cipher suites in patch()
                sc = SSLContext.getInstance("TLSv1.2");
                Log.i(TAG, "apply(): system SSLContext (Conscrypt not available)");
            }
            sc.init(null, new TrustManager[]{tm}, null);

            Tls12SocketFactory factory = new Tls12SocketFactory(sc.getSocketFactory());
            builder.sslSocketFactory(factory, tm);

            String[] ciphers = sc.getSocketFactory().getSupportedCipherSuites();
            Log.i(TAG, "Provider=" + sc.getProvider().getName()
                    + " ciphers=" + ciphers.length);
            // Log ECDHE ciphers specifically (these are needed for Render/Cloudflare)
            for (String c : ciphers) {
                if (c.contains("ECDHE")) Log.d(TAG, "  " + c);
            }

            // Accept any TLS 1.2 cipher — let the server and client negotiate
            ConnectionSpec cs = new ConnectionSpec.Builder(ConnectionSpec.COMPATIBLE_TLS)
                    .tlsVersions(TlsVersion.TLS_1_2)
                    .allEnabledCipherSuites()
                    .build();
            java.util.List<ConnectionSpec> specs = new java.util.ArrayList<>();
            specs.add(cs);
            specs.add(ConnectionSpec.CLEARTEXT);
            builder.connectionSpecs(specs);
        } catch (Throwable e) {
            Log.e(TAG, "apply() failed completely: " + e.getMessage(), e);
        }
        return builder;
    }
}
    }
}
