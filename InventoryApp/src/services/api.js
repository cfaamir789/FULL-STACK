import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const CLOUD_SERVER_URL = "https://full-stack-4m9b.onrender.com";
export const CLOUD_SERVER_FAILOVER =
  "https://inventory-backend-fdex.onrender.com";
export const CLOUD_SERVERS = [CLOUD_SERVER_URL, CLOUD_SERVER_FAILOVER];
export const DEFAULT_SERVER_IP = CLOUD_SERVER_URL;

const isPrivateHost = (host) => {
  const h = String(host || "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
};

const normalizeServerAddress = (addr) => {
  let value = (addr || DEFAULT_SERVER_IP).trim();
  if (!value) {
    return DEFAULT_SERVER_IP;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    value = value.replace(/\/+$/, "");
    value = value.replace(/\/admin$/i, "");
    value = value.replace(/\/api$/i, "");
    const host = value
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0];
    if (Platform.OS !== "web" && !__DEV__ && isPrivateHost(host)) {
      return CLOUD_SERVER_URL;
    }
    return value;
  }

  value = value.replace(/\/+$/, "");
  value = value.replace(/\/admin$/i, "");
  value = value.replace(/\/api$/i, "");
  const host = value.split(":")[0];
  if (Platform.OS !== "web" && !__DEV__ && isPrivateHost(host)) {
    return CLOUD_SERVER_URL;
  }
  return value;
};

// Builds the API base URL from a server address.
// Supports: bare IP ("192.168.1.5"), IP:port ("192.168.1.5:5000"),
// or full URL ("https://myapp.onrender.com")
const buildBaseUrl = (addr) => {
  const s = normalizeServerAddress(addr);
  if (s.startsWith("http://") || s.startsWith("https://")) {
    // Full URL — strip trailing slash, append /api if missing
    const clean = s.replace(/\/+$/, "");
    return clean.endsWith("/api") ? clean : `${clean}/api`;
  }
  // Bare IP or IP:port
  return s.includes(":") ? `http://${s}/api` : `http://${s}:5000/api`;
};

let currentBaseUrl = buildBaseUrl(DEFAULT_SERVER_IP);

export const getBaseUrl = () => currentBaseUrl;

// Returns a display-friendly server address (for showing in UI)
export const getDisplayUrl = () => {
  // Strip /api suffix for display
  return currentBaseUrl.replace(/\/api$/, "");
};

const apiClient = axios.create({
  baseURL: currentBaseUrl,
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

// Separate client with a short timeout just for reachability checks
const healthClient = axios.create({
  baseURL: currentBaseUrl,
  timeout: 3000,
  headers: { "Content-Type": "application/json" },
});

// Call on app start — loads saved server address from storage
export const loadServerUrl = async () => {
  try {
    const savedRaw = await AsyncStorage.getItem("serverIp");
    const saved = normalizeServerAddress(savedRaw || DEFAULT_SERVER_IP);
    if (saved && saved.trim()) {
      if (savedRaw !== saved) {
        await AsyncStorage.setItem("serverIp", saved);
      }
      currentBaseUrl = buildBaseUrl(saved);
      apiClient.defaults.baseURL = currentBaseUrl;
      healthClient.defaults.baseURL = currentBaseUrl;
      return saved.trim();
    }
  } catch (_) {}
  return DEFAULT_SERVER_IP;
};

// Update server address and persist it (accepts IP, IP:port, or full URL)
export const setServerIp = async (ip) => {
  const trimmed = normalizeServerAddress(ip);
  currentBaseUrl = buildBaseUrl(trimmed);
  apiClient.defaults.baseURL = currentBaseUrl;
  healthClient.defaults.baseURL = currentBaseUrl;
  await AsyncStorage.setItem("serverIp", trimmed);
};

// Attach stored JWT to every request automatically
apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("authToken");
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// ─── Failover: auto-switch to backup server on network errors ─────────────
let _failoverActive = false;

const switchToNextServer = async () => {
  // Find which cloud server we're currently NOT using
  const currentServer = currentBaseUrl.replace(/\/api$/, "");
  const next = CLOUD_SERVERS.find((s) => s !== currentServer);
  if (!next) return false;

  console.log(`[Failover] Switching from ${currentServer} to ${next}`);
  currentBaseUrl = `${next}/api`;
  apiClient.defaults.baseURL = currentBaseUrl;
  healthClient.defaults.baseURL = currentBaseUrl;
  return true;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    // Only attempt failover once per request, and only for network/5xx errors
    if (
      !config._failoverAttempted &&
      !_failoverActive &&
      (error.code === "ECONNABORTED" ||
        !error.response ||
        error.response.status >= 502)
    ) {
      config._failoverAttempted = true;
      _failoverActive = true;
      const switched = await switchToNextServer();
      _failoverActive = false;
      if (switched) {
        config.baseURL = currentBaseUrl;
        return apiClient.request(config);
      }
    }
    return Promise.reject(error);
  },
);

healthClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (
      !config._failoverAttempted &&
      !_failoverActive &&
      (error.code === "ECONNABORTED" ||
        !error.response ||
        error.response.status >= 502)
    ) {
      config._failoverAttempted = true;
      _failoverActive = true;
      const switched = await switchToNextServer();
      _failoverActive = false;
      if (switched) {
        config.baseURL = currentBaseUrl;
        return healthClient.request(config);
      }
    }
    return Promise.reject(error);
  },
);

export const checkHealth = async () => {
  // Try current server first, then failover picks up automatically via interceptor
  try {
    const beforeMs = Date.now();
    const res = await healthClient.get("/health");
    const afterMs = Date.now();
    // Calculate server time offset (server - local) accounting for network latency
    if (res.data?.serverTime) {
      const roundTrip = afterMs - beforeMs;
      const localAtResponse = beforeMs + Math.round(roundTrip / 2);
      const offset = res.data.serverTime - localAtResponse;
      await AsyncStorage.setItem("serverTimeOffset", String(offset));
    }
    return res.data;
  } catch (err) {
    // If failover interceptor already switched, this will have been retried.
    // If still failing, try all servers explicitly
    for (const server of CLOUD_SERVERS) {
      try {
        const beforeMs = Date.now();
        const res = await axios.get(`${server}/api/health`, { timeout: 5000 });
        const afterMs = Date.now();
        if (res.data?.status === "ok") {
          // Switch to this working server
          currentBaseUrl = `${server}/api`;
          apiClient.defaults.baseURL = currentBaseUrl;
          healthClient.defaults.baseURL = currentBaseUrl;
          // Calculate server time offset
          if (res.data?.serverTime) {
            const roundTrip = afterMs - beforeMs;
            const localAtResponse = beforeMs + Math.round(roundTrip / 2);
            const offset = res.data.serverTime - localAtResponse;
            await AsyncStorage.setItem("serverTimeOffset", String(offset));
          }
          console.log(
            `[Failover] Health check found working server: ${server}`,
          );
          return res.data;
        }
      } catch (_) {}
    }
    throw err;
  }
};

// Get server-aligned timestamp (uses offset from last health check)
export const getServerTime = async () => {
  try {
    const offsetStr = await AsyncStorage.getItem("serverTimeOffset");
    const offset = offsetStr ? Number(offsetStr) : 0;
    return new Date(Date.now() + offset);
  } catch {
    return new Date();
  }
};

export const getServerTimeISO = async () => {
  const t = await getServerTime();
  return t.toISOString();
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const checkSetup = async () => {
  const res = await healthClient.get("/auth/check-setup");
  return res.data; // { needsSetup: true/false }
};

export const setupAdmin = async (username, pin) => {
  const res = await apiClient.post("/auth/setup", { username, pin });
  return res.data; // { token, username, role }
};

export const loginUser = async (username, pin) => {
  const res = await apiClient.post("/auth/login", { username, pin });
  return res.data; // { token, username, role }
};

export const registerWorker = async (username, pin, role = "worker") => {
  const res = await apiClient.post("/auth/register", { username, pin, role });
  return res.data;
};

export const getUsers = async () => {
  const res = await apiClient.get("/auth/users");
  return res.data.users;
};

export const deleteUser = async (username) => {
  const res = await apiClient.delete(`/auth/users/${username}`);
  return res.data;
};

// ─── Items ────────────────────────────────────────────────────────────────────

export const fetchItems = async () => {
  const res = await apiClient.get("/items");
  return res.data.items;
};

export const fetchItemsPage = async (page = 1, limit = 2000) => {
  const res = await apiClient.get(
    `/items?paginated=1&page=${page}&limit=${limit}`,
  );
  return res.data; // { items, total, page, limit }
};

export const fetchItemsVersion = async () => {
  const res = await healthClient.get("/items/version");
  return res.data; // { version, totalItems }
};

// Download ALL items in a single request (gzip compressed by server).
// Used for atomic item master download — no pagination, no partial data.
export const fetchItemsBulk = async () => {
  const res = await apiClient.get("/items/bulk", { timeout: 120000 });
  return res.data; // { version, total, items }
};

export const syncTransactions = async (transactions) => {
  const res = await apiClient.post("/sync", { transactions });
  return res.data;
};

export const importItemsToBackend = async (itemsArray) => {
  const res = await apiClient.post("/items/import", { items: itemsArray });
  return res.data;
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const getTransactionStats = async () => {
  const res = await apiClient.get("/transactions/stats");
  return res.data;
};

export const getServerTransactions = async (
  page = 1,
  limit = 50,
  status = "pending",
) => {
  const res = await apiClient.get(
    `/transactions?page=${page}&limit=${limit}&status=${encodeURIComponent(status)}`,
  );
  return res.data;
};

export const setServerTransactionStatus = async ({
  ids,
  worker,
  status,
  fromStatus = "all",
}) => {
  const res = await apiClient.post("/transactions/bulk-status", {
    ids,
    worker,
    status,
    fromStatus,
  });
  return res.data;
};

export const getExportUrl = () => `${currentBaseUrl}/transactions/export`;

export const clearServerTransactions = async () => {
  const res = await apiClient.delete("/transactions/all");
  return res.data;
};

export const clearServerItems = async () => {
  const res = await apiClient.delete("/items/all");
  return res.data;
};

export const replaceServerItems = async (itemsArray) => {
  const res = await apiClient.post("/items/replace", { items: itemsArray });
  return res.data;
};
