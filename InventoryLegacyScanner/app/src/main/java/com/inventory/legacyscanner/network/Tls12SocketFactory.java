package com.inventory.legacyscanner.network;

import android.os.Build;
import android.util.Log;

import org.conscrypt.Conscrypt;

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
 * Provides modern TLS on Android 4.x by using the bundled Conscrypt (BoringSSL) provider.
 * The stock Android 4.4 OpenSSL is ancient and lacks modern cipher suites;
 * Conscrypt replaces it entirely so TLS 1.2 with modern ciphers works.
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String TAG = "Tls12SF";
    private static final String[] TLS_V12 = {"TLSv1.2"};
    private final SSLSocketFactory delegate;
    private static volatile boolean conscryptInstalled = false;

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
    }

    /**
     * Install Conscrypt as the primary security provider.
     * MUST be called from Application.onCreate() before any network call.
     */
    public static synchronized void installProvider() {
        if (conscryptInstalled) return;
        try {
            Provider provider = Conscrypt.newProvider();
            int pos = Security.insertProviderAt(provider, 1);
            conscryptInstalled = true;
            Log.i(TAG, "Conscrypt provider installed at position " + pos);

            // Verify by creating an SSLContext with Conscrypt
            SSLContext test = SSLContext.getInstance("TLSv1.2", provider);
            Log.i(TAG, "SSLContext provider: " + test.getProvider().getName()
                    + " (" + test.getProvider().getClass().getName() + ")");
            String[] ciphers = test.getSocketFactory().getSupportedCipherSuites();
            Log.i(TAG, "Supported ciphers: " + ciphers.length);
            for (int i = 0; i < Math.min(5, ciphers.length); i++) {
                Log.d(TAG, "  cipher: " + ciphers[i]);
            }
        } catch (Throwable e) {
            Log.e(TAG, "Conscrypt installation FAILED: " + e.getClass().getName() + ": " + e.getMessage(), e);
        }
    }

    public static boolean isConscryptInstalled() {
        return conscryptInstalled;
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

    private static Socket patch(Socket socket) {
        if (socket instanceof SSLSocket) {
            SSLSocket ssl = (SSLSocket) socket;
            ssl.setEnabledProtocols(TLS_V12);
            // Enable all supported cipher suites from Conscrypt
            ssl.setEnabledCipherSuites(ssl.getSupportedCipherSuites());
        }
        return socket;
    }

    /**
     * Configure an OkHttpClient.Builder with Conscrypt TLS for Android 4.x.
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
                // Explicitly request Conscrypt provider — do NOT let JCE fall back
                Provider conscrypt = Security.getProvider("Conscrypt");
                if (conscrypt != null) {
                    sc = SSLContext.getInstance("TLSv1.2", conscrypt);
                    Log.i(TAG, "apply(): using Conscrypt SSLContext");
                } else {
                    sc = SSLContext.getInstance("TLSv1.2");
                    Log.w(TAG, "apply(): Conscrypt provider not found, using default");
                }
            } else {
                sc = SSLContext.getInstance("TLSv1.2");
                Log.w(TAG, "apply(): Conscrypt NOT installed, using system TLS");
            }
            sc.init(null, new TrustManager[]{tm}, null);

            Tls12SocketFactory factory = new Tls12SocketFactory(sc.getSocketFactory());
            builder.sslSocketFactory(factory, tm);

            Log.i(TAG, "SSLContext.provider=" + sc.getProvider().getName()
                    + " ciphers=" + sc.getSocketFactory().getSupportedCipherSuites().length);

            // Allow any TLS 1.2 cipher suite
            ConnectionSpec cs = new ConnectionSpec.Builder(ConnectionSpec.COMPATIBLE_TLS)
                    .tlsVersions(TlsVersion.TLS_1_2)
                    .allEnabledCipherSuites()
                    .build();
            java.util.List<ConnectionSpec> specs = new java.util.ArrayList<>();
            specs.add(cs);
            specs.add(ConnectionSpec.CLEARTEXT);
            builder.connectionSpecs(specs);
        } catch (Exception e) {
            Log.e(TAG, "apply() failed: " + e.getMessage(), e);
        }
        return builder;
    }
}
