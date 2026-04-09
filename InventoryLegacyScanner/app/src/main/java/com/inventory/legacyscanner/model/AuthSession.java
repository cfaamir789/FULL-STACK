package com.inventory.legacyscanner.model;

public class AuthSession {
    public final String token;
    public final String username;
    public final String role;
    public final String serverAddress;

    public AuthSession(String token, String username, String role, String serverAddress) {
        this.token = token;
        this.username = username;
        this.role = role;
        this.serverAddress = serverAddress;
    }
}
