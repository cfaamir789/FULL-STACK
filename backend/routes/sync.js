const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Transaction = require("../models/Transaction");
const WorkerSync = require("../models/WorkerSync");
const { appendTransactions } = require("../services/googleSheets");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

// Fail fast if MongoDB is not connected
function requireDB(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error: "Database is not connected. Please try again shortly.",
    });
  }
  next();
}

const PENDING_QUERY = {
  $or: [
    { syncStatus: { $exists: false } },
    { syncStatus: null },
    { syncStatus: "pending" },
  ],
};

const toDate = (value, fallback = new Date()) => {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const normalizeStatus = (value, fallback = "pending") => {
  const status = String(value || fallback)
    .trim()
    .toLowerCase();
  if (["pending", "processed", "archived", "all", "active"].includes(status)) {
    return status;
  }
  return fallback;
};

const buildStatusQuery = (status) => {
  const normalized = normalizeStatus(status, "pending");
  if (normalized === "all") {
    return {};
  }
  if (normalized === "processed") {
    return { syncStatus: "processed" };
  }
  if (normalized === "archived") {
    return { syncStatus: "archived" };
  }
  return PENDING_QUERY;
};

const makeLegacyClientTxId = (tx) => {
  const barcode = String(tx.Item_Barcode || "unknown").trim();
  const deviceId = String(tx.deviceId || tx.Worker_Name || "unknown").trim();
  const timestamp = toDate(tx.Timestamp).toISOString();
  return `legacy:${deviceId}:${barcode}:${timestamp}`;
};

const hasMeaningfulChange = (existing, incoming) => {
  return (
    String(existing.Item_Barcode || "") !==
      String(incoming.Item_Barcode || "") ||
    String(existing.Item_Code || "") !== String(incoming.Item_Code || "") ||
    String(existing.Item_Name || "") !== String(incoming.Item_Name || "") ||
    String(existing.Frombin || "") !== String(incoming.Frombin || "") ||
    String(existing.Tobin || "") !== String(incoming.Tobin || "") ||
    Number(existing.Qty || 0) !== Number(incoming.Qty || 0) ||
    String(existing.Notes || "") !== String(incoming.Notes || "") ||
    String(existing.deviceId || "") !== String(incoming.deviceId || "") ||
    String(existing.Worker_Name || "") !== String(incoming.Worker_Name || "") ||
    toDate(existing.Timestamp).toISOString() !==
      toDate(incoming.Timestamp).toISOString()
  );
};

const applyIncomingTransaction = (target, incoming) => {
  target.clientTxId = incoming.clientTxId;
  target.clientUpdatedAt = incoming.clientUpdatedAt;
  target.Item_Barcode = incoming.Item_Barcode;
  target.Item_Code = incoming.Item_Code;
  target.Item_Name = incoming.Item_Name;
  target.Frombin = incoming.Frombin;
  target.Tobin = incoming.Tobin;
  target.Qty = incoming.Qty;
  target.Timestamp = incoming.Timestamp;
  target.Notes = incoming.Notes;
  target.deviceId = incoming.deviceId;
  target.Worker_Name = incoming.Worker_Name;
  target.lastSyncedAt = new Date();
  if (!target.syncStatus) {
    target.syncStatus = "pending";
  }
};

async function recordWorkerSync(workerName, count) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const doc = await WorkerSync.findOne({ worker: workerName });
  if (!doc) {
    await WorkerSync.create({
      worker: workerName,
      lastSync: now,
      totalToday: count,
      lastResetDate: todayStr,
    });
    return;
  }

  doc.lastSync = now;
  if (doc.lastResetDate !== todayStr) {
    doc.totalToday = count;
    doc.lastResetDate = todayStr;
  } else {
    doc.totalToday += count;
  }
  await doc.save();
}

router.get("/worker-status", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const docs = await WorkerSync.find().sort({ lastSync: -1 }).lean();
    const workers = docs.map((doc) => ({
      worker: doc.worker,
      lastSync: doc.lastSync,
      totalToday: doc.totalToday,
      minutesAgo: Math.round(
        (Date.now() - new Date(doc.lastSync).getTime()) / 60000,
      ),
    }));
    res.json({ success: true, workers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", requireDB, requireAuth, async (req, res) => {
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

    const workerName = req.user.username;
    const docs = transactions.map((tx) => ({
      clientTxId:
        String(
          tx.Client_Tx_Id || tx.clientTxId || tx.client_tx_id || "",
        ).trim() || makeLegacyClientTxId(tx),
      clientUpdatedAt: toDate(
        tx.UpdatedAt || tx.updatedAt || tx.updated_at || tx.Timestamp,
      ),
      Item_Barcode: String(tx.Item_Barcode || "").trim(),
      Item_Code: String(tx.Item_Code || "").trim(),
      Item_Name: String(tx.Item_Name || "").trim(),
      Frombin: String(tx.Frombin || "").trim(),
      Tobin: String(tx.Tobin || "").trim(),
      Qty: Number(tx.Qty),
      Timestamp: toDate(tx.Timestamp),
      Notes: String(tx.Notes || "").trim(),
      deviceId: String(tx.deviceId || workerName || "unknown").trim(),
      Worker_Name: workerName,
    }));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let locked = 0;
    const sheetRows = [];

    for (const doc of docs) {
      let existing = await Transaction.findOne({ clientTxId: doc.clientTxId });

      if (!existing) {
        existing = await Transaction.findOne({
          clientTxId: { $exists: false },
          Item_Barcode: doc.Item_Barcode,
          Timestamp: doc.Timestamp,
          deviceId: doc.deviceId,
        });
      }

      if (!existing) {
        const created = new Transaction({
          ...doc,
          syncStatus: "pending",
          lastSyncedAt: new Date(),
          createdAt: new Date(),
        });
        await created.save();
        inserted += 1;
        sheetRows.push(created.toObject());
        continue;
      }

      const currentStatus = normalizeStatus(existing.syncStatus, "pending");
      if (currentStatus === "processed" || currentStatus === "archived") {
        if (!existing.clientTxId) {
          existing.clientTxId = doc.clientTxId;
        }
        if (!existing.clientUpdatedAt) {
          existing.clientUpdatedAt = doc.clientUpdatedAt;
        }
        existing.lastSyncedAt = new Date();
        await existing.save();
        locked += 1;
        continue;
      }

      const existingUpdatedAt = toDate(
        existing.clientUpdatedAt || existing.Timestamp || existing.createdAt,
      );
      const incomingIsNewer = doc.clientUpdatedAt >= existingUpdatedAt;
      const changed = hasMeaningfulChange(existing, doc);

      if (changed && incomingIsNewer) {
        applyIncomingTransaction(existing, doc);
        existing.syncStatus = "pending";
        await existing.save();
        updated += 1;
      } else {
        if (!existing.clientTxId) {
          existing.clientTxId = doc.clientTxId;
        }
        if (!existing.clientUpdatedAt) {
          existing.clientUpdatedAt = doc.clientUpdatedAt;
        }
        existing.lastSyncedAt = new Date();
        if (!existing.syncStatus) {
          existing.syncStatus = "pending";
        }
        await existing.save();
        unchanged += 1;
      }
    }

    await recordWorkerSync(workerName, inserted + updated);
    if (sheetRows.length > 0) {
      appendTransactions(sheetRows).catch(() => {});
    }

    res.json({
      success: true,
      synced: docs.length,
      inserted,
      updated,
      unchanged,
      locked,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;
    const query = buildStatusQuery(req.query.status || "pending");

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ Timestamp: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(query),
    ]);

    res.json({ success: true, total, page, limit, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/bulk-status", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => String(id)).filter(Boolean))]
      : [];
    const worker = req.body?.worker
      ? String(req.body.worker).trim().toUpperCase()
      : "";
    const fromStatus = normalizeStatus(req.body?.fromStatus || "all", "all");
    const nextStatus = normalizeStatus(req.body?.status, "pending");
    const erpDocument = String(req.body?.erpDocument || "")
      .trim()
      .toUpperCase();
    const erpBatch = String(req.body?.erpBatch || "")
      .trim()
      .toUpperCase();

    if (!["pending", "processed", "archived"].includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        error: "status must be pending, processed, or archived.",
      });
    }

    const filter = {};
    if (ids.length > 0) {
      filter._id = { $in: ids };
    } else if (worker) {
      filter.Worker_Name = worker;
    } else {
      return res.status(400).json({
        success: false,
        error: "Provide transaction ids or a worker name.",
      });
    }

    if (fromStatus !== "all") {
      Object.assign(filter, buildStatusQuery(fromStatus));
    }

    const update = { syncStatus: nextStatus };
    if (nextStatus === "processed") {
      update.processedAt = new Date();
      update.processedBy = req.user.username;
      update.erpDocument = erpDocument;
      update.erpBatch = erpBatch;
      update.archivedAt = null;
    } else if (nextStatus === "archived") {
      update.archivedAt = new Date();
    } else {
      update.processedAt = null;
      update.processedBy = "";
      update.erpDocument = "";
      update.erpBatch = "";
      update.archivedAt = null;
    }

    const result = await Transaction.updateMany(filter, { $set: update });
    res.json({
      success: true,
      matched: result.matchedCount || 0,
      updated: result.modifiedCount || 0,
      status: nextStatus,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/bulk-delete", requireDB, requireAuth, requireAdmin, async (req, res) => {
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

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ _id: req.params.id });
    if (!tx) {
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found." });
    }
    if (req.user.role !== "admin" && tx.Worker_Name !== req.user.username) {
      return res.status(403).json({
        success: false,
        error: "You can only edit your own transactions.",
      });
    }

    const { Frombin, Tobin, Qty, Notes } = req.body;
    const updated = await Transaction.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          Frombin,
          Tobin,
          Qty: Number(Qty),
          Notes: Notes || tx.Notes || "",
          syncStatus: "pending",
          clientUpdatedAt: new Date(),
        },
      },
      { new: true },
    );
    res.json({ success: true, transaction: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (req.params.id === "all") {
      return next();
    }

    const tx = await Transaction.findOne({ _id: req.params.id });
    if (!tx) {
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found." });
    }
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

router.get("/stats", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const [pendingTx, totalAll, totalProcessed, totalArchived] =
      await Promise.all([
        Transaction.find(PENDING_QUERY),
        Transaction.countDocuments({}),
        Transaction.countDocuments({ syncStatus: "processed" }),
        Transaction.countDocuments({ syncStatus: "archived" }),
      ]);

    const workerMap = {};
    for (const tx of pendingTx) {
      const worker = tx.Worker_Name || "unknown";
      if (!workerMap[worker]) {
        workerMap[worker] = {
          worker,
          count: 0,
          lastTransaction: null,
        };
      }
      workerMap[worker].count += 1;
      const timestamp = tx.Timestamp ? new Date(tx.Timestamp) : null;
      if (
        timestamp &&
        (!workerMap[worker].lastTransaction ||
          timestamp > new Date(workerMap[worker].lastTransaction))
      ) {
        workerMap[worker].lastTransaction = timestamp.toISOString();
      }
    }

    const workers = Object.values(workerMap).sort((a, b) => b.count - a.count);
    res.json({
      success: true,
      total: pendingTx.length,
      totalPending: pendingTx.length,
      totalProcessed,
      totalArchived,
      totalAll,
      workers,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/export", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { worker, json, status } = req.query;
    const query = {
      ...(worker ? { Worker_Name: worker } : {}),
      ...buildStatusQuery(status || "all"),
    };
    const transactions = await Transaction.find(query)
      .sort({ Timestamp: -1 })
      .lean();

    if (json === "1") {
      return res.json(transactions);
    }

    const header =
      "Status,Processed_At,Processed_By,ERP_Document,ERP_Batch,Item_Barcode,Item_Code,Item_Name,From_Bin,To_Bin,Qty,Worker,Notes,Timestamp\n";
    const rows = transactions
      .map((tx) => {
        const escape = (value) =>
          `"${String(value || "").replace(/"/g, '""')}"`;
        return [
          escape(tx.syncStatus || "pending"),
          escape(tx.processedAt ? new Date(tx.processedAt).toISOString() : ""),
          escape(tx.processedBy || ""),
          escape(tx.erpDocument || ""),
          escape(tx.erpBatch || ""),
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
