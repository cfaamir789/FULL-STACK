package com.inventory.legacyscanner.network;

import android.os.Build;
import android.util.Log;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.Security;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.jsse.BCSSLSocket;
import org.bouncycastle.jsse.BCSNIHostName;
import org.bouncycastle.jsse.BCSNIServerName;
import org.bouncycastle.jsse.BCSSLParameters;
import org.bouncycastle.jsse.provider.BouncyCastleJsseProvider;

import okhttp3.ConnectionSpec;
import okhttp3.OkHttpClient;
import okhttp3.TlsVersion;

/**
 * TLS 1.2 on Android 4.4 via BouncyCastle JSSE (pure Java).
 *
 * Three things Android 4.4 breaks that this class fixes:
 * 1) The stock OpenSSL provider lacks ECDHE+GCM ciphers Cloudflare needs.
 *    → BouncyCastle provides them (pure Java, no native libs, no GMS).
 * 2) Android's JSSE SPI ignores third-party providers registered by name.
 *    → We store the BouncyCastleJsseProvider INSTANCE and pass it directly
 *      to SSLContext.getInstance() / TrustManagerFactory.getInstance().
 * 3) OkHttp sets SNI via reflection on Android's internal SSLSocket class,
 *    which doesn't exist on BCSSLSocket.
 *    → We set SNI ourselves via BCSSLSocket.setParameters(BCSSLParameters).
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String TAG = "Tls12SF";
    private static final String[] TLS_V12 = {"TLSv1.2"};
    private static final String TLS_FALLBACK_SCSV = "TLS_FALLBACK_SCSV";

    private final SSLSocketFactory delegate;
    private static volatile String providerStatus = "not initialized";

    // Provider INSTANCES — never looked up by string name on Android
    private static volatile BouncyCastleJsseProvider sProvider;
    private static volatile X509TrustManager sTrustManager;

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
    }

    /**
     * Install BouncyCastle JCE + JSSE. Call once from Application.onCreate().
     */
    public static synchronized boolean installProvider() {
        if (Build.VERSION.SDK_INT >= 21) {
            providerStatus = "API" + Build.VERSION.SDK_INT + " native TLS";
            return true;
        }
        try {
            // ── Step 1: Full BouncyCastle JCE (replace Android's stripped one) ──
            Security.removeProvider("BC");
            BouncyCastleProvider bcProv = new BouncyCastleProvider();
            Security.insertProviderAt(bcProv, 1);
            Log.i(TAG, "BC JCE v" + bcProv.getVersion() + " installed at pos 1");

            // ── Step 2: BCJSSE linked to our BC JCE (provider OBJECT, not name) ──
            sProvider = new BouncyCastleJsseProvider(bcProv);
            Security.insertProviderAt(sProvider, 2);
            Log.i(TAG, "BCJSSE provider installed at pos 2");

            // ── Step 3: Copy Android system CAs into a KeyStore BCJSSE can read ──
            TrustManagerFactory sysTmf = TrustManagerFactory.getInstance(
                    TrustManagerFactory.getDefaultAlgorithm());
            sysTmf.init((KeyStore) null);
            X509TrustManager sysTm = null;
            for (TrustManager tm : sysTmf.getTrustManagers()) {
                if (tm instanceof X509TrustManager) { sysTm = (X509TrustManager) tm; break; }
            }
            if (sysTm == null) {
                providerStatus = "no system X509TrustManager";
                return false;
            }
            X509Certificate[] systemCAs = sysTm.getAcceptedIssuers();
            KeyStore bcKeyStore = KeyStore.getInstance(KeyStore.getDefaultType());
            bcKeyStore.load(null, null);
            for (int i = 0; i < systemCAs.length; i++) {
                bcKeyStore.setCertificateEntry("ca_" + i, systemCAs[i]);
            }
            Log.i(TAG, "Copied " + systemCAs.length + " system CAs into BCJSSE KeyStore");

            // ── Step 4: BCJSSE TrustManager from provider INSTANCE ──
            TrustManagerFactory bcTmf = TrustManagerFactory.getInstance("PKIX", sProvider);
            bcTmf.init(bcKeyStore);
            for (TrustManager tm : bcTmf.getTrustManagers()) {
                if (tm instanceof X509TrustManager) { sTrustManager = (X509TrustManager) tm; break; }
            }
            if (sTrustManager == null) {
                providerStatus = "no BCJSSE X509TrustManager";
                return false;
            }

            // ── Step 5: Verify SSLContext creation works ──
            SSLContext test = SSLContext.getInstance("TLSv1.2", sProvider);
            test.init(null, new TrustManager[]{sTrustManager}, new SecureRandom());
            String[] ciphers = filterCipherSuites(
                    test.getSocketFactory().getSupportedCipherSuites());
            providerStatus = "BCJSSE " + ciphers.length + " ciphers";
            Log.i(TAG, providerStatus);
            for (String c : ciphers) {
                if (c.contains("ECDHE") || c.contains("GCM")) Log.d(TAG, "  " + c);
            }
            return true;
        } catch (Throwable e) {
            sProvider = null;
            sTrustManager = null;
            providerStatus = "BCJSSE fail: " + e.getClass().getSimpleName()
                    + ": " + e.getMessage();
            Log.e(TAG, "installProvider failed", e);
            return false;
        }
    }

    public static boolean isConscryptInstalled() { return false; }
    public static String getProviderStatus() { return providerStatus; }

    // ─── SSLSocketFactory delegate methods ─────────────────────────────────

    @Override public String[] getDefaultCipherSuites() {
        return filterCipherSuites(delegate.getDefaultCipherSuites());
    }
    @Override public String[] getSupportedCipherSuites() {
        return filterCipherSuites(delegate.getSupportedCipherSuites());
    }

    @Override
    public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
        return patchAndSni(delegate.createSocket(s, host, port, autoClose), host);
    }
    @Override
    public Socket createSocket(String host, int port) throws IOException {
        return patchAndSni(delegate.createSocket(host, port), host);
    }
    @Override
    public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
        return patchAndSni(delegate.createSocket(host, port, localHost, localPort), host);
    }
    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        return patch(delegate.createSocket(host, port));
    }
    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
        return patch(delegate.createSocket(address, port, localAddress, localPort));
    }

    // ─── SNI via BouncyCastle's own API (not Android's broken reflection) ──

    private static Socket patchAndSni(Socket socket, String host) {
        if (socket instanceof BCSSLSocket && host != null && !host.isEmpty()) {
            try {
                BCSSLSocket bcSsl = (BCSSLSocket) socket;
                BCSSLParameters params = bcSsl.getParameters();
                List<BCSNIServerName> names = new ArrayList<BCSNIServerName>();
                names.add(new BCSNIHostName(host));
                params.setServerNames(names);
                bcSsl.setParameters(params);
                Log.d(TAG, "SNI → " + host);
            } catch (Throwable e) {
                Log.w(TAG, "SNI failed for " + host + ": " + e.getMessage());
            }
        }
        return patch(socket);
    }

    private static Socket patch(Socket socket) {
        if (socket instanceof SSLSocket) {
            SSLSocket ssl = (SSLSocket) socket;
            ssl.setEnabledProtocols(TLS_V12);
            ssl.setEnabledCipherSuites(filterCipherSuites(ssl.getSupportedCipherSuites()));
        }
        return socket;
    }

    private static String[] filterCipherSuites(String[] suites) {
        List<String> out = new ArrayList<String>();
        for (String s : suites) {
            if (!TLS_FALLBACK_SCSV.equals(s)) out.add(s);
        }
        return out.toArray(new String[0]);
    }

    // ─── OkHttp integration ───────────────────────────────────────────────

    public static OkHttpClient.Builder apply(OkHttpClient.Builder builder) {
        if (Build.VERSION.SDK_INT >= 21) return builder;
        try {
            SSLContext sc;
            X509TrustManager tm;

            if (sProvider != null && sTrustManager != null) {
                // BCJSSE path — provider OBJECT (not string name)
                sc = SSLContext.getInstance("TLSv1.2", sProvider);
                tm = sTrustManager;
                sc.init(null, new TrustManager[]{tm}, new SecureRandom());
                Log.i(TAG, "apply(): using BCJSSE provider instance");
            } else {
                // Fallback: system TLS (will probably fail on Cloudflare)
                Log.w(TAG, "apply(): BCJSSE unavailable, system TLS fallback");
                TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                        TrustManagerFactory.getDefaultAlgorithm());
                tmf.init((KeyStore) null);
                tm = (X509TrustManager) tmf.getTrustManagers()[0];
                sc = SSLContext.getInstance("TLSv1.2");
                sc.init(null, new TrustManager[]{tm}, null);
            }

            builder.sslSocketFactory(new Tls12SocketFactory(sc.getSocketFactory()), tm);

            String[] ciphers = filterCipherSuites(
                    sc.getSocketFactory().getSupportedCipherSuites());
            providerStatus = sc.getProvider().getName() + " " + ciphers.length + " ciphers";
            Log.i(TAG, "OkHttp TLS: " + providerStatus);

            ConnectionSpec cs = new ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                    .tlsVersions(TlsVersion.TLS_1_2)
                    .allEnabledCipherSuites()
                    .supportsTlsExtensions(true)
                    .build();
            builder.connectionSpecs(Collections.singletonList(cs));
        } catch (Throwable e) {
            providerStatus = "apply fail: " + e.getMessage();
            Log.e(TAG, "apply() failed", e);
        }
        return builder;
    }
}
