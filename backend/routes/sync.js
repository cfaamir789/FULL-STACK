const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");
const { appendTransactions } = require("../services/googleSheets");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

// ─── Worker Sync Status Tracking ─────────────────────────────────────────────
// In-memory map: { workerName: { lastSync, pendingPushed, totalToday } }
const workerSyncStatus = {};

function recordWorkerSync(workerName, count) {
  const now = new Date().toISOString();
  if (!workerSyncStatus[workerName]) {
    workerSyncStatus[workerName] = { lastSync: now, totalToday: 0 };
  }
  workerSyncStatus[workerName].lastSync = now;
  workerSyncStatus[workerName].totalToday += count;
}

// GET /api/sync/worker-status — admin: see last sync time per worker
router.get("/worker-status", requireAuth, requireAdmin, async (req, res) => {
  const workers = Object.entries(workerSyncStatus).map(([name, info]) => ({
    worker: name,
    lastSync: info.lastSync,
    totalToday: info.totalToday,
    minutesAgo: Math.round(
      (Date.now() - new Date(info.lastSync).getTime()) / 60000,
    ),
  }));
  workers.sort((a, b) => new Date(b.lastSync) - new Date(a.lastSync));
  res.json({ success: true, workers });
});

// POST /api/sync — receive array of offline transactions (requires login)
router.post("/", requireAuth, async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "transactions array is required" });
    }
    for (const tx of transactions) {
      if (
        !tx.Item_Barcode ||
        !tx.Item_Name ||
        !tx.Frombin ||
        !tx.Tobin ||
        !tx.Qty ||
        !tx.Timestamp
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Each transaction must have Item_Barcode, Item_Name, Frombin, Tobin, Qty, Timestamp",
        });
      }
    }
    // worker_name comes from the verified JWT — client cannot spoof it
    const workerName = req.user.username;
    const docs = transactions.map((tx) => ({
      Item_Barcode: tx.Item_Barcode,
      Item_Code: tx.Item_Code || "",
      Item_Name: tx.Item_Name,
      Frombin: tx.Frombin,
      Tobin: tx.Tobin,
      Qty: Number(tx.Qty),
      Timestamp: new Date(tx.Timestamp),
      Notes: tx.Notes || "",
      deviceId: tx.deviceId || "unknown",
      Worker_Name: workerName,
      createdAt: new Date(),
    }));
    await Transaction.insertMany(docs);
    // Track this worker's sync activity
    recordWorkerSync(workerName, docs.length);
    // Append to Google Sheet asynchronously — never blocks the phone response
    appendTransactions(docs).catch(() => {});
    res.json({ success: true, synced: docs.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/transactions — return all transactions (newest first, paginated)
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find({}).sort({ Timestamp: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments({}),
    ]);
    res.json({ success: true, total, page, limit, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/transactions/bulk-delete — admin: delete many transactions at once
router.post("/bulk-delete", requireAuth, requireAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => String(id)).filter(Boolean))]
      : [];
    const worker = req.body?.worker
      ? String(req.body.worker).trim().toUpperCase()
      : "";

    if (ids.length > 0) {
      let deleted = 0;
      for (const id of ids) {
        const delResult = await Transaction.deleteOne({ _id: id });
        deleted += delResult.deletedCount;
      }
      return res.json({ success: true, deleted });
    }

    if (worker) {
      const delResult = await Transaction.deleteMany({ Worker_Name: worker });
      return res.json({ success: true, deleted: delResult.deletedCount });
    }

    return res.status(400).json({
      success: false,
      error: "Provide transaction ids or a worker name.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/transactions/:id — edit (owner or admin only)
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ _id: req.params.id });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found." });
    if (req.user.role !== "admin" && tx.Worker_Name !== req.user.username) {
      return res.status(403).json({
        success: false,
        error: "You can only edit your own transactions.",
      });
    }
    const { Frombin, Tobin, Qty } = req.body;
    const updated = await Transaction.findByIdAndUpdate(
      req.params.id,
      { $set: { Frombin, Tobin, Qty: Number(Qty) } },
      { new: true },
    );
    res.json({ success: true, transaction: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/transactions/:id — delete (owner or admin only)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (req.params.id === "all") {
      return next();
    }
    const tx = await Transaction.findOne({ _id: req.params.id });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found." });
    if (req.user.role !== "admin" && tx.Worker_Name !== req.user.username) {
      return res.status(403).json({
        success: false,
        error: "You can only delete your own transactions.",
      });
    }
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/transactions/stats — admin dashboard stats per worker
router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    const allTx = await Transaction.find({});
    const workerMap = {};
    for (const tx of allTx) {
      const w = tx.Worker_Name || "unknown";
      if (!workerMap[w]) {
        workerMap[w] = { worker: w, count: 0, lastTransaction: null };
      }
      workerMap[w].count++;
      const ts = tx.Timestamp ? new Date(tx.Timestamp) : null;
      if (
        ts &&
        (!workerMap[w].lastTransaction ||
          ts > new Date(workerMap[w].lastTransaction))
      ) {
        workerMap[w].lastTransaction = ts.toISOString();
      }
    }
    const workers = Object.values(workerMap).sort((a, b) => b.count - a.count);
    const total = allTx.length;
    res.json({ success: true, total, workers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/transactions/export — export all transactions as CSV (admin only)
router.get("/export", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { worker } = req.query;
    const query = worker ? { Worker_Name: worker } : {};
    const transactions = await Transaction.find(query).sort({ Timestamp: -1 });
    const header =
      "Item_Barcode,Item_Code,Item_Name,From_Bin,To_Bin,Qty,Worker,Notes,Timestamp\n";
    const rows = transactions
      .map((tx) => {
        const escape = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
        return [
          escape(tx.Item_Barcode),
          escape(tx.Item_Code),
          escape(tx.Item_Name),
          escape(tx.Frombin),
          escape(tx.Tobin),
          tx.Qty,
          escape(tx.Worker_Name),
          escape(tx.Notes),
          escape(tx.Timestamp ? new Date(tx.Timestamp).toISOString() : ""),
        ].join(",");
      })
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=transactions_export.csv",
    );
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/transactions/all — admin: clear ALL transactions from server after export
router.delete("/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await Transaction.countDocuments({});
    await Transaction.deleteMany({});
    res.json({ success: true, deleted: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
