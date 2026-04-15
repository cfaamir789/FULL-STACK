export const mapServerTransactionToLocalShape = (tx) => ({
  id: tx._id,
  server_id: tx._id,
  client_tx_id: tx.clientTxId || "",
  item_barcode: tx.Item_Barcode || "",
  item_code: tx.Item_Code || "",
  item_name: tx.Item_Name || "",
  frombin: tx.Frombin || "",
  tobin: tx.Tobin || "",
  qty: tx.Qty ?? 0,
  uom: tx.UOM || "PCS",
  worker_name: tx.Worker_Name || "unknown",
  notes: tx.Notes || "",
  timestamp: tx.Timestamp,
  synced: 1,
  erp_document: tx.erpDocument || "",
  erp_batch: tx.erpBatch || "",
  sync_status: tx.syncStatus || "pending",
  _source: "server",
});

export const isTransactionOwnedByUser = (tx, username) =>
  String(tx?.worker_name || tx?.Worker_Name || "unknown")
    .trim()
    .toUpperCase() === String(username || "").trim().toUpperCase();

export const buildTransactionKey = (tx) => {
  const clientTxId = String(tx?.client_tx_id || tx?.clientTxId || "").trim();
  if (clientTxId) return `client:${clientTxId}`;

  const serverId = String(tx?.server_id || tx?._id || "").trim();
  if (serverId) return `server:${serverId}`;

  const worker = String(tx?.worker_name || tx?.Worker_Name || "unknown").trim();
  const barcode = String(tx?.item_barcode || tx?.Item_Barcode || "").trim();
  const timestamp = new Date(tx?.timestamp || tx?.Timestamp || 0).toISOString();
  const frombin = String(tx?.frombin || tx?.Frombin || "").trim();
  const tobin = String(tx?.tobin || tx?.Tobin || "").trim();
  const qty = String(tx?.qty ?? tx?.Qty ?? "");
  return `fallback:${worker}:${barcode}:${timestamp}:${frombin}:${tobin}:${qty}`;
};

export const sortTransactionsNewestFirst = (transactions) =>
  [...transactions].sort(
    (a, b) => new Date(b.timestamp || b.Timestamp || 0) - new Date(a.timestamp || a.Timestamp || 0),
  );

export const mergeTransactions = (...groups) => {
  const merged = new Map();

  for (const group of groups) {
    for (const tx of group || []) {
      const key = buildTransactionKey(tx);
      const current = merged.get(key);

      if (!current) {
        merged.set(key, tx);
        continue;
      }

      const currentSynced = Number(current.synced) === 1;
      const nextSynced = Number(tx.synced) === 1;
      if (currentSynced && !nextSynced) {
        merged.set(key, tx);
      }
    }
  }

  return sortTransactionsNewestFirst(Array.from(merged.values()));
};
