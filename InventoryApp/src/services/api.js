import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_SERVER_IP = '192.168.1.44';

let currentBaseUrl = `http://${DEFAULT_SERVER_IP}:5000/api`;

export const getBaseUrl = () => currentBaseUrl;

const apiClient = axios.create({
  baseURL: currentBaseUrl,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Separate client with a short timeout just for reachability checks
const healthClient = axios.create({
  baseURL: currentBaseUrl,
  timeout: 3000,
  headers: { 'Content-Type': 'application/json' },
});

// Call on app start — loads saved server IP from storage
export const loadServerUrl = async () => {
  try {
    const saved = await AsyncStorage.getItem('serverIp');
    if (saved && saved.trim()) {
      currentBaseUrl = `http://${saved.trim()}:5000/api`;
      apiClient.defaults.baseURL = currentBaseUrl;
      healthClient.defaults.baseURL = currentBaseUrl;
      return saved.trim();
    }
  } catch (_) {}
  return DEFAULT_SERVER_IP;
};

// Update server IP and persist it
export const setServerIp = async (ip) => {
  const trimmed = ip.trim();
  currentBaseUrl = `http://${trimmed}:5000/api`;
  apiClient.defaults.baseURL = currentBaseUrl;
  healthClient.defaults.baseURL = currentBaseUrl;
  await AsyncStorage.setItem('serverIp', trimmed);
};

// Attach stored JWT to every request automatically
apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('authToken');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

export const checkHealth = async () => {
  const res = await healthClient.get('/health');
  return res.data;
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const checkSetup = async () => {
  const res = await healthClient.get('/auth/check-setup');
  return res.data; // { needsSetup: true/false }
};

export const setupAdmin = async (username, pin) => {
  const res = await apiClient.post('/auth/setup', { username, pin });
  return res.data; // { token, username, role }
};

export const loginUser = async (username, pin) => {
  const res = await apiClient.post('/auth/login', { username, pin });
  return res.data; // { token, username, role }
};

export const registerWorker = async (username, pin, role = 'worker') => {
  const res = await apiClient.post('/auth/register', { username, pin, role });
  return res.data;
};

export const getUsers = async () => {
  const res = await apiClient.get('/auth/users');
  return res.data.users;
};

export const deleteUser = async (username) => {
  const res = await apiClient.delete(`/auth/users/${username}`);
  return res.data;
};

// ─── Items ────────────────────────────────────────────────────────────────────

export const fetchItems = async () => {
  const res = await apiClient.get('/items');
  return res.data.items;
};

export const syncTransactions = async (transactions) => {
  const res = await apiClient.post('/sync', { transactions });
  return res.data;
};

export const importItemsToBackend = async (itemsArray) => {
  const res = await apiClient.post('/items/import', { items: itemsArray });
  return res.data;
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const getTransactionStats = async () => {
  const res = await apiClient.get('/transactions/stats');
  return res.data;
};

export const getServerTransactions = async (page = 1, limit = 50) => {
  const res = await apiClient.get(`/transactions?page=${page}&limit=${limit}`);
  return res.data;
};

export const getExportUrl = () => `${currentBaseUrl}/transactions/export`;

export const clearServerTransactions = async () => {
  const res = await apiClient.delete('/transactions/all');
  return res.data;
};

export const clearServerItems = async () => {
  const res = await apiClient.delete('/items/all');
  return res.data;
};

export const replaceServerItems = async (itemsArray) => {
  const res = await apiClient.post('/items/replace', { items: itemsArray });
  return res.data;
};

