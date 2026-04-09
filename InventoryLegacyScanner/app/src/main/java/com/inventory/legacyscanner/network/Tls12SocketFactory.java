package com.inventory.legacyscanner.network;

import android.os.Build;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;

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
 * Enables TLS 1.2 on Android 4.x devices where it exists but is disabled by default.
 */
public final class Tls12SocketFactory extends SSLSocketFactory {
    private static final String[] TLS_12 = {"TLSv1.2", "TLSv1.1", "TLSv1"};
    private final SSLSocketFactory delegate;

    private Tls12SocketFactory(SSLSocketFactory delegate) {
        this.delegate = delegate;
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
            ((SSLSocket) socket).setEnabledProtocols(TLS_12);
        }
        return socket;
    }

    /**
     * Apply TLS 1.2 to an OkHttpClient.Builder for Android 4.x compatibility.
     * On API 21+ this is a no-op (TLS 1.2 is already the default).
     */
    public static OkHttpClient.Builder apply(OkHttpClient.Builder builder) {
        if (Build.VERSION.SDK_INT >= 21) {
            return builder;
        }
        try {
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((java.security.KeyStore) null);
            TrustManager[] trustManagers = tmf.getTrustManagers();
            X509TrustManager tm = (X509TrustManager) trustManagers[0];

            SSLContext sc = SSLContext.getInstance("TLSv1.2");
            sc.init(null, new TrustManager[]{tm}, null);
            Tls12SocketFactory factory = new Tls12SocketFactory(sc.getSocketFactory());

            builder.sslSocketFactory(factory, tm);

            ConnectionSpec cs = new ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                    .tlsVersions(TlsVersion.TLS_1_2, TlsVersion.TLS_1_1, TlsVersion.TLS_1_0)
                    .build();

            java.util.List<ConnectionSpec> specs = new java.util.ArrayList<>();
            specs.add(cs);
            specs.add(ConnectionSpec.CLEARTEXT);
            builder.connectionSpecs(specs);
        } catch (NoSuchAlgorithmException | KeyManagementException e) {
            // Fall back to default
        } catch (Exception e) {
            // Fall back to default
        }
        return builder;
    }
}
