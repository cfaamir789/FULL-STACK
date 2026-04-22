import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const CLOUD_SERVER_URL = "https://fullstck-production.up.railway.app";
export const CLOUD_SERVER_FAILOVER = "https://fullstck.onrender.com";
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
  timeout: 8000,
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
let _healthCache = { ts: 0, data: null, promise: null };
const HEALTH_CACHE_MS = 10000;

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
  const now = Date.now();
  if (_healthCache.data && now - _healthCache.ts < HEALTH_CACHE_MS) {
    return _healthCache.data;
  }
  if (_healthCache.promise) {
    return _healthCache.promise;
  }

  _healthCache.promise = (async () => {
    try {
      const beforeMs = Date.now();
      const res = await healthClient.get("/health");
      const afterMs = Date.now();
      if (res.data?.serverTime) {
        const roundTrip = afterMs - beforeMs;
        const localAtResponse = beforeMs + Math.round(roundTrip / 2);
        const offset = res.data.serverTime - localAtResponse;
        await AsyncStorage.setItem("serverTimeOffset", String(offset));
      }
      _healthCache.data = res.data;
      _healthCache.ts = Date.now();
      return res.data;
    } catch (err) {
      for (const server of CLOUD_SERVERS) {
        try {
          const beforeMs = Date.now();
          const res = await axios.get(`${server}/api/health`, {
            timeout: 5000,
          });
          const afterMs = Date.now();
          if (res.data?.status === "ok") {
            currentBaseUrl = `${server}/api`;
            apiClient.defaults.baseURL = currentBaseUrl;
            healthClient.defaults.baseURL = currentBaseUrl;
            if (res.data?.serverTime) {
              const roundTrip = afterMs - beforeMs;
              const localAtResponse = beforeMs + Math.round(roundTrip / 2);
              const offset = res.data.serverTime - localAtResponse;
              await AsyncStorage.setItem("serverTimeOffset", String(offset));
            }
            console.log(
              `[Failover] Health check found working server: ${server}`,
            );
            _healthCache.data = res.data;
            _healthCache.ts = Date.now();
            return res.data;
          }
        } catch (_) {}
      }
      throw err;
    } finally {
      _healthCache.promise = null;
    }
  })();

  return _healthCache.promise;
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
  // Try the configured server first
  try {
    const res = await healthClient.get("/auth/check-setup");
    return res.data; // { needsSetup: true/false }
  } catch (primaryErr) {
    // Explicitly try each cloud server before giving up
    for (const server of CLOUD_SERVERS) {
      const serverApiUrl = `${server}/api`;
      if (serverApiUrl === currentBaseUrl) continue; // already tried
      try {
        const res = await axios.get(`${serverApiUrl}/auth/check-setup`, {
          timeout: 8000,
        });
        if (res.data?.success !== false) {
          // Switch to this working server
          currentBaseUrl = serverApiUrl;
          apiClient.defaults.baseURL = currentBaseUrl;
          healthClient.defaults.baseURL = currentBaseUrl;
          return res.data;
        }
      } catch (_) {}
    }
    throw primaryErr; // all servers unreachable
  }
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

export const getUserCount = async () => {
  const res = await apiClient.get("/auth/users?countOnly=1");
  return Number(res.data.total || 0);
};

export const deleteUser = async (username) => {
  const res = await apiClient.delete(`/auth/users/${username}`);
  return res.data;
};

export const changeUserRole = async (username, role) => {
  const res = await apiClient.put(`/auth/users/${username}/role`, { role });
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

// Download one page of items. Low-memory-safe — phone fetches page by page.
export const fetchItemsBulkPage = async (page = 1, limit = 5000) => {
  const res = await apiClient.get(
    `/items/bulk-page?page=${page}&limit=${limit}`,
    { timeout: 60000 },
  );
  return res.data; // { version, page, totalPages, totalItems, count, items }
};

// Download only items created/updated after `since` (ISO string).
// Pass `lastFullSync` (ISO) so server can detect if a full replace happened.
// Returns { version, serverTime, requiresFullSync, items, total }
export const fetchItemsDelta = async (since, lastFullSync) => {
  const params = new URLSearchParams({ since });
  if (lastFullSync) params.set("lastFullSync", lastFullSync);
  const res = await apiClient.get(`/items/delta?${params}`, { timeout: 30000 });
  return res.data;
};

export const syncTransactions = async (transactions) => {
  // 60-second timeout: budget phones on slow networks + Render free tier can be slow.
  // The server saves data before responding, so if 10s fires the phone never gets the ack.
  const res = await apiClient.post(
    "/sync",
    { transactions },
    { timeout: 60000 },
  );
  return res.data;
};

// Ask server which of these clientTxIds it already has (fallback after timeout)
export const verifySyncedTxIds = async (clientTxIds) => {
  const res = await apiClient.post(
    "/sync/verify",
    { clientTxIds },
    { timeout: 30000 },
  );
  return res.data; // { success, found: [clientTxId, ...] }
};

// Check if server wants us to clear synced data
export const checkClearCommand = async () => {
  const res = await apiClient.get("/sync/clear-check");
  return res.data; // { success, clearBefore }
};

// Acknowledge clear completed
export const ackClear = async () => {
  const res = await apiClient.post("/sync/clear-ack");
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
  options = {},
) => {
  const params = [
    `page=${encodeURIComponent(String(page))}`,
    `limit=${encodeURIComponent(String(limit))}`,
    `status=${encodeURIComponent(String(status || "pending"))}`,
  ];
  if (options.mine) {
    params.push("mine=1");
  }
  if (options.worker) {
    params.push(
      `worker=${encodeURIComponent(
        String(options.worker).trim().toUpperCase(),
      )}`,
    );
  }
  if (options.after) {
    params.push(`after=${encodeURIComponent(String(options.after))}`);
  }
  const res = await apiClient.get(`/transactions?${params.join("&")}`);
  return res.data;
};

export const getAllServerTransactions = async ({
  status = "all",
  mine = false,
  worker = "",
  pageSize = 200,
  maxPages = 100,
} = {}) => {
  let page = 1;
  let total = 0;
  const transactions = [];

  while (page <= maxPages) {
    const data = await getServerTransactions(page, pageSize, status, {
      mine,
      worker,
    });
    const batch = data.transactions || [];
    total = Number(data.total || 0);
    transactions.push(...batch);

    if (batch.length === 0 || transactions.length >= total) {
      break;
    }
    page += 1;
  }

  return { success: true, total, transactions };
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

// ─── Bin Content ──────────────────────────────────────────────────────────────

// Lightweight version check — used to see if phone needs to re-download
export const fetchBinContentVersion = async () => {
  const res = await healthClient.get("/bin-content/version");
  return res.data; // { version, total }
};

// Full bulk download — gzip compressed, returns { version, total, items: [{BinCode,ItemCode,Qty}] }
export const fetchBinContentBulk = async (etag) => {
  const headers = etag ? { "If-None-Match": etag } : {};
  const res = await apiClient.get("/bin-content/bulk", {
    timeout: 120000,
    headers,
    validateStatus: (s) => s === 200 || s === 304,
  });
  if (res.status === 304) return { notModified: true };
  return res.data; // { version, total, items }
};

// Delta — only records updated since `since` (ISO string)
export const fetchBinContentDelta = async (since) => {
  const res = await apiClient.get(
    `/bin-content/delta?since=${encodeURIComponent(since)}`,
    { timeout: 30000 },
  );
  return res.data; // { version, serverTime, total, items }
};

// Fetch all bins for a specific item (live from server — fallback when local data may be stale)
export const fetchBinsForItem = async (itemCode) => {
  const res = await apiClient.get(
    `/bin-content/by-item/${encodeURIComponent(itemCode)}`,
    { timeout: 10000 },
  );
  return res.data.bins || []; // [{ BinCode, Qty, BinRanking, ZoneCode }]
};

// ─── Bin Content Browse (admin) ───────────────────────────────────────────────

// Single request: stats + categories + zones (server serves from RAM cache)
// Replaces 3 separate HTTP calls on screen open.
export const fetchBinContentMeta = async () => {
  const res = await apiClient.get("/bin-content/meta", { timeout: 10000 });
  return res.data; // { success, stats, categories, zoneCodes }
};

// Paginated list with search, filters, sort
export const fetchBinContentList = async ({
  q,
  page = 1,
  limit = 50,
  categories,
  zoneCodes,
  chambers,
  sort,
} = {}) => {
  const params = { page, limit };
  if (q) params.q = q;
  if (categories) params.categories = categories;
  if (zoneCodes) params.zoneCodes = zoneCodes;
  if (chambers) params.chambers = chambers;
  if (sort) params.sort = sort;
  const res = await apiClient.get("/bin-content", { params, timeout: 15000 });
  return res.data; // { success, bins, total, page, limit, totalQty }
};

// Distinct category codes for filter chips
export const fetchBinContentCategories = async () => {
  const res = await apiClient.get("/bin-content/categories", {
    timeout: 10000,
  });
  return res.data.categories || [];
};

// Distinct zone codes for filter chips
export const fetchBinContentZones = async () => {
  const res = await apiClient.get("/bin-content/zone-codes", {
    timeout: 10000,
  });
  return res.data.zoneCodes || [];
};

// Chamber labels (static list)
export const fetchBinContentChambers = async () => {
  const res = await apiClient.get("/bin-content/chambers", { timeout: 5000 });
  return res.data.chambers || [];
};

// Aggregated stats
export const fetchBinContentStats = async () => {
  const res = await apiClient.get("/bin-content/stats", { timeout: 10000 });
  return res.data; // { total, upper, floor, display, uniqueBins, uniqueItems, totalQty, ... }
};

// ─── Bin Master ───────────────────────────────────────────────────────────────

// Returns flat list of ALL bin codes from the bin master
export const fetchBinMasterCodes = async () => {
  const res = await apiClient.get("/bin-master/codes", { timeout: 60000 });
  return res.data; // { success, codes: [...], total, version }
};

// Quick version check — phones call this to decide if they need to re-download
export const fetchBinMasterVersion = async () => {
  const res = await apiClient.get("/bin-master/version", { timeout: 10000 });
  return res.data; // { success, total, version }
};
