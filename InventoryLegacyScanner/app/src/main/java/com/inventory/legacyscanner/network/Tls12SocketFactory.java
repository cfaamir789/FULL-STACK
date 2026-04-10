package com.inventory.legacyscanner.network;

import android.os.Build;
import android.util.Log;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.Security;
import java.security.cert.CertificateFactory;
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
 * Fixes four things Android 4.4 breaks:
 * 1) Stock OpenSSL lacks ECDHE+GCM ciphers → BouncyCastle provides them.
 * 2) Android ignores third-party JSSE providers by name → use INSTANCE.
 * 3) OkHttp sets SNI via Android-internal reflection → BCSSLSocket API.
 * 4) Android 4.4 trust store lacks GTS Root R1/R4 → embedded PEM certs.
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String TAG = "Tls12SF";
    private static final String[] TLS_V12 = {"TLSv1.2"};
    private static final String TLS_FALLBACK_SCSV = "TLS_FALLBACK_SCSV";

    private final SSLSocketFactory delegate;
    private static volatile String providerStatus = "not initialized";

    private static volatile BouncyCastleJsseProvider sProvider;
    private static volatile X509TrustManager sTrustManager;

    // ── Root CAs embedded as PEM strings (no Context/resources needed) ────
    // Render chain: onrender.com → WE1 → GTS Root R4 → GlobalSign Root CA

    /** GTS Root R4 — self-signed, EC P-384, valid 2016–2036 */
    private static final String GTS_ROOT_R4 =
        "-----BEGIN CERTIFICATE-----\n"
        + "MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD\n"
        + "VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n"
        + "A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n"
        + "WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n"
        + "IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n"
        + "AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi\n"
        + "QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR\n"
        + "HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n"
        + "BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D\n"
        + "9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8\n"
        + "p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD\n"
        + "-----END CERTIFICATE-----";

    /** GTS Root R1 — self-signed, RSA 4096, valid 2016–2036 */
    private static final String GTS_ROOT_R1 =
        "-----BEGIN CERTIFICATE-----\n"
        + "MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw\n"
        + "CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU\n"
        + "MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw\n"
        + "MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp\n"
        + "Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA\n"
        + "A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo\n"
        + "27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w\n"
        + "Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw\n"
        + "TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl\n"
        + "qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH\n"
        + "szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8\n"
        + "Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk\n"
        + "MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92\n"
        + "wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p\n"
        + "aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN\n"
        + "VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID\n"
        + "AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E\n"
        + "FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb\n"
        + "C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe\n"
        + "QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy\n"
        + "h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4\n"
        + "7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J\n"
        + "ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef\n"
        + "MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/\n"
        + "Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT\n"
        + "6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ\n"
        + "0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm\n"
        + "2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb\n"
        + "bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c\n"
        + "-----END CERTIFICATE-----";

    /** GlobalSign Root CA — self-signed, RSA 2048, valid 1998–2028 */
    private static final String GLOBALSIGN_ROOT =
        "-----BEGIN CERTIFICATE-----\n"
        + "MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n"
        + "A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n"
        + "b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n"
        + "MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n"
        + "YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n"
        + "aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n"
        + "jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n"
        + "xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n"
        + "1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n"
        + "snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n"
        + "U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n"
        + "9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n"
        + "BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n"
        + "AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n"
        + "yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n"
        + "38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n"
        + "AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n"
        + "DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n"
        + "HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n"
        + "-----END CERTIFICATE-----";

    private static final String[] BUNDLED_PEMS = {
        GTS_ROOT_R4, GTS_ROOT_R1, GLOBALSIGN_ROOT
    };
    private static final String[] BUNDLED_NAMES = {
        "gts_root_r4", "gts_root_r1", "globalsign_root"
    };

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
    }

    /**
     * Install BouncyCastle JCE + JSSE with embedded root CAs.
     * No Context needed — certs are hardcoded PEM strings.
     * Call once from Application.onCreate().
     */
    public static synchronized boolean installProvider() {
        if (Build.VERSION.SDK_INT >= 21) {
            providerStatus = "API" + Build.VERSION.SDK_INT + " native TLS";
            return true;
        }
        try {
            // ── Step 1: Full BouncyCastle JCE ──
            Security.removeProvider("BC");
            BouncyCastleProvider bcProv = new BouncyCastleProvider();
            Security.insertProviderAt(bcProv, 1);
            Log.i(TAG, "BC JCE v" + bcProv.getVersion());

            // ── Step 2: BCJSSE provider INSTANCE ──
            sProvider = new BouncyCastleJsseProvider(bcProv);
            Security.insertProviderAt(sProvider, 2);

            // ── Step 3: Build KeyStore with system CAs + embedded CAs ──
            KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);

            // 3a: System CAs
            int count = 0;
            try {
                TrustManagerFactory sysTmf = TrustManagerFactory.getInstance(
                        TrustManagerFactory.getDefaultAlgorithm());
                sysTmf.init((KeyStore) null);
                for (TrustManager tm : sysTmf.getTrustManagers()) {
                    if (tm instanceof X509TrustManager) {
                        for (X509Certificate ca : ((X509TrustManager) tm).getAcceptedIssuers()) {
                            ks.setCertificateEntry("sys_" + count, ca);
                            count++;
                        }
                        break;
                    }
                }
            } catch (Throwable e) {
                Log.w(TAG, "System CAs failed: " + e.getMessage());
            }
            Log.i(TAG, count + " system CAs loaded");

            // 3b: Embedded PEM root CAs (no I/O, no Context, no resources)
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            for (int i = 0; i < BUNDLED_PEMS.length; i++) {
                try {
                    ByteArrayInputStream bis = new ByteArrayInputStream(
                            BUNDLED_PEMS[i].getBytes("UTF-8"));
                    X509Certificate cert = (X509Certificate) cf.generateCertificate(bis);
                    ks.setCertificateEntry("bundled_" + BUNDLED_NAMES[i], cert);
                    Log.i(TAG, "Bundled: " + cert.getSubjectDN());
                    count++;
                } catch (Throwable e) {
                    Log.w(TAG, "Bundle " + BUNDLED_NAMES[i] + " failed: " + e);
                }
            }
            Log.i(TAG, "Total trust store: " + count + " CAs");

            // ── Step 4: BCJSSE TrustManager from provider INSTANCE ──
            TrustManagerFactory bcTmf = TrustManagerFactory.getInstance("PKIX", sProvider);
            bcTmf.init(ks);
            for (TrustManager tm : bcTmf.getTrustManagers()) {
                if (tm instanceof X509TrustManager) { sTrustManager = (X509TrustManager) tm; break; }
            }
            if (sTrustManager == null) {
                providerStatus = "no BCJSSE TrustManager";
                return false;
            }

            // ── Step 5: Verify ──
            SSLContext test = SSLContext.getInstance("TLSv1.2", sProvider);
            test.init(null, new TrustManager[]{sTrustManager}, new SecureRandom());
            String[] ciphers = filterCipherSuites(
                    test.getSocketFactory().getSupportedCipherSuites());
            providerStatus = "BCJSSE " + ciphers.length + " ciphers";
            Log.i(TAG, providerStatus);
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
