import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE THIS to your PC's local IP address (run `ipconfig` in Windows Terminal
// and look for "IPv4 Address" under your WiFi adapter, e.g. 192.168.1.100)
// ─────────────────────────────────────────────────────────────────────────────
export const PC_LOCAL_IP = '192.168.1.44';
export const BASE_URL = `http://${PC_LOCAL_IP}:5000/api`;

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export const checkHealth = async () => {
  const res = await apiClient.get('/health');
  return res.data;
};

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
