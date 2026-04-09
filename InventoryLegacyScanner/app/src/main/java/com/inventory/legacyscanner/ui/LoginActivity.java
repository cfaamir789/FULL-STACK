package com.inventory.legacyscanner.ui;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.inventory.legacyscanner.R;
import com.inventory.legacyscanner.config.AppConfig;
import com.inventory.legacyscanner.data.PrefsStore;
import com.inventory.legacyscanner.model.AuthSession;
import com.inventory.legacyscanner.network.ApiClient;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LoginActivity extends AppCompatActivity {
    private EditText etServer, etUsername, etPin;
    private Button btnLogin;
    private ProgressBar progress;
    private TextView tvError;
    private final ExecutorService exec = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // If already logged in, skip to main
        String token = PrefsStore.getToken(this);
        if (!TextUtils.isEmpty(token)) {
            startActivity(new Intent(this, MainActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_login);

        etServer = findViewById(R.id.etServer);
        etUsername = findViewById(R.id.etUsername);
        etPin = findViewById(R.id.etPin);
        btnLogin = findViewById(R.id.btnLogin);
        progress = findViewById(R.id.progressLogin);
        tvError = findViewById(R.id.tvError);

        etServer.setText(PrefsStore.getServerAddress(this));

        btnLogin.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doLogin();
            }
        });
    }

    private void doLogin() {
        final String server = etServer.getText().toString().trim();
        final String username = etUsername.getText().toString().trim();
        final String pin = etPin.getText().toString().trim();

        if (TextUtils.isEmpty(username) || TextUtils.isEmpty(pin)) {
            showError("Username and PIN are required");
            return;
        }
        if (TextUtils.isEmpty(server)) {
            showError("Server address is required");
            return;
        }

        setLoading(true);
        tvError.setVisibility(View.GONE);

        exec.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final AuthSession session = ApiClient.login(LoginActivity.this, server, username, pin);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            PrefsStore.saveSession(LoginActivity.this, session);
                            Toast.makeText(LoginActivity.this, "Welcome " + session.username, Toast.LENGTH_SHORT).show();
                            startActivity(new Intent(LoginActivity.this, MainActivity.class));
                            finish();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setLoading(false);
                            showError(e.getMessage());
                        }
                    });
                }
            }
        });
    }

    private void setLoading(boolean loading) {
        progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnLogin.setEnabled(!loading);
    }

    private void showError(String msg) {
        tvError.setText(msg);
        tvError.setVisibility(View.VISIBLE);
    }
}
