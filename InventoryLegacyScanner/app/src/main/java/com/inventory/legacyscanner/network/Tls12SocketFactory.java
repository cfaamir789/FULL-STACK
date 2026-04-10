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
 * Provides modern TLS (1.2+) on Android 4.x by using Conscrypt (bundled BoringSSL).
 * The stock Android 4.4 OpenSSL lacks modern cipher suites; Conscrypt fixes that.
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String TAG = "Tls12SocketFactory";
    private static final String[] TLS_V12 = {"TLSv1.2"};
    private final SSLSocketFactory delegate;

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
    }

    /**
     * Install Conscrypt as the top security provider. Call once from Application.onCreate().
     * This gives the entire JVM modern TLS + cipher suites on old Android.
     */
    public static void installConscrypt() {
        try {
            Class<?> conscryptClass = Class.forName("org.conscrypt.Conscrypt");
            java.lang.reflect.Method newProvider = conscryptClass.getMethod("newProvider");
            Provider provider = (Provider) newProvider.invoke(null);
            Security.insertProviderAt(provider, 1);
            Log.i(TAG, "Conscrypt installed as top security provider");
        } catch (Exception e) {
            Log.w(TAG, "Conscrypt install failed: " + e.getMessage());
        }
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
        return enableTls12(delegate.createSocket(s, host, port, autoClose));
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
        return enableTls12(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
        return enableTls12(delegate.createSocket(host, port, localHost, localPort));
    }

    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        return enableTls12(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
        return enableTls12(delegate.createSocket(address, port, localAddress, localPort));
    }

    private static Socket enableTls12(Socket socket) {
        if (socket instanceof SSLSocket) {
            ((SSLSocket) socket).setEnabledProtocols(TLS_V12);
        }
        return socket;
    }

    /**
     * Apply modern TLS to an OkHttpClient.Builder.
     * Uses Conscrypt's SSLContext (installed at app startup) for modern cipher suites.
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

            // Conscrypt is now the top provider, so getInstance("TLSv1.2")
            // will use Conscrypt's BoringSSL with modern cipher suites.
            SSLContext sc = SSLContext.getInstance("TLSv1.2");
            sc.init(null, new TrustManager[]{tm}, null);

            Tls12SocketFactory factory = new Tls12SocketFactory(sc.getSocketFactory());
            builder.sslSocketFactory(factory, tm);

            // Log available ciphers for debugging
            String[] ciphers = sc.getSocketFactory().getSupportedCipherSuites();
            Log.i(TAG, "SSLContext provider: " + sc.getProvider().getName()
                    + ", supported ciphers: " + ciphers.length);

            ConnectionSpec cs = new ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                    .tlsVersions(TlsVersion.TLS_1_2)
                    .build();
            java.util.List<ConnectionSpec> specs = new java.util.ArrayList<>();
            specs.add(cs);
            specs.add(ConnectionSpec.CLEARTEXT);
            builder.connectionSpecs(specs);
        } catch (Exception e) {
            Log.e(TAG, "Failed to apply TLS 1.2: " + e.getMessage());
        }
        return builder;
    }
}
