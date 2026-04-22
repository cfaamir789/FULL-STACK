const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Transaction = require("../models/Transaction");
const WorkerSync = require("../models/WorkerSync");
const { appendTransactions } = require("../services/googleSheets");
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/authMiddleware");
const AuditLog = require("../models/AuditLog");

function audit(actor, actorRole, action, target, detail, source) {
  AuditLog.create({ actor, actorRole, action, target, detail, source }).catch(
    () => {},
  );
}

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

// Server timezone: Riyadh (UTC+3) — day resets at midnight Riyadh time
const SERVER_TZ = "Asia/Riyadh";
const getTodayStr = (date = new Date()) => {
  // Returns YYYY-MM-DD in Riyadh timezone
  return date.toLocaleDateString("en-CA", { timeZone: SERVER_TZ });
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

const buildStatusSort = (status) => {
  const normalized = normalizeStatus(status, "pending");
  if (normalized === "processed") {
    return { processedAt: -1, Timestamp: -1, createdAt: -1 };
  }
  if (normalized === "archived") {
    return { archivedAt: -1, processedAt: -1, Timestamp: -1, createdAt: -1 };
  }
  return { Timestamp: -1, createdAt: -1 };
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
  target.UOM = incoming.UOM || "PCS";
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
  const todayStr = getTodayStr(now);
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

router.get(
  "/worker-status",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const todayStr = getTodayStr();
      // Riyadh day boundaries (UTC+3)
      const todayStart = new Date(todayStr + "T00:00:00+03:00");
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      // Fetch WorkerSync docs and live today-counts from Transaction in parallel
      const [docs, todayAgg] = await Promise.all([
        WorkerSync.find(
          {},
          "worker lastSync totalToday lastResetDate clearBefore",
        )
          .sort({ lastSync: -1 })
          .lean(),
        Transaction.aggregate([
          { $match: { lastSyncedAt: { $gte: todayStart, $lt: todayEnd } } },
          { $group: { _id: "$Worker_Name", count: { $sum: 1 } } },
        ]),
      ]);

      // Build a quick lookup: workerName -> live count for today
      const liveTodayMap = {};
      for (const row of todayAgg) {
        if (row._id) liveTodayMap[row._id] = row.count;
      }

      const workers = docs.map((doc) => ({
        worker: doc.worker,
        lastSync: doc.lastSync,
        // Prefer live Transaction count; fall back to cached counter
        totalToday:
          liveTodayMap[doc.worker] !== undefined
            ? liveTodayMap[doc.worker]
            : doc.lastResetDate === todayStr
              ? doc.totalToday || 0
              : 0,
        minutesAgo: Math.round(
          (Date.now() - new Date(doc.lastSync).getTime()) / 60000,
        ),
        clearBefore: doc.clearBefore ? doc.clearBefore.toISOString() : null,
      }));
      res.json({
        success: true,
        workers,
        serverTime: new Date().toISOString(),
        timezone: SERVER_TZ,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

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
    const now = new Date();

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
      UOM: String(tx.UOM || tx.uom || "PCS").trim(),
      Timestamp: toDate(tx.Timestamp),
      Notes: String(tx.Notes || "").trim(),
      deviceId: String(tx.deviceId || workerName || "unknown").trim(),
      Worker_Name: workerName,
    }));

    // ── BATCH LOOKUP: one query instead of N individual findOne calls ──────────
    // Build a map of all known clientTxIds in one round-trip
    const allClientTxIds = docs.map((d) => d.clientTxId);
    const existingDocs = await Transaction.find({
      clientTxId: { $in: allClientTxIds },
    }).lean();
    const existingMap = new Map(existingDocs.map((e) => [e.clientTxId, e]));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let locked = 0;
    const toInsert = [];
    const toUpdate = []; // { id, update }
    const sheetRows = [];

    for (const doc of docs) {
      const existing = existingMap.get(doc.clientTxId);

      if (!existing) {
        toInsert.push({
          clientTxId: doc.clientTxId,
          clientUpdatedAt: doc.clientUpdatedAt,
          Item_Barcode: doc.Item_Barcode,
          Item_Code: doc.Item_Code,
          Item_Name: doc.Item_Name,
          Frombin: doc.Frombin,
          Tobin: doc.Tobin,
          Qty: doc.Qty,
          UOM: doc.UOM,
          Timestamp: doc.Timestamp,
          Notes: doc.Notes,
          deviceId: doc.deviceId,
          Worker_Name: doc.Worker_Name,
          syncStatus: "pending",
          lastSyncedAt: now,
          createdAt: now,
        });
        inserted += 1;
        continue;
      }

      const currentStatus = normalizeStatus(existing.syncStatus, "pending");
      if (currentStatus === "processed" || currentStatus === "archived") {
        toUpdate.push({
          id: existing._id,
          update: {
            $set: {
              clientTxId: existing.clientTxId || doc.clientTxId,
              clientUpdatedAt: existing.clientUpdatedAt || doc.clientUpdatedAt,
              lastSyncedAt: now,
            },
          },
        });
        locked += 1;
        continue;
      }

      const existingUpdatedAt = toDate(
        existing.clientUpdatedAt || existing.Timestamp || existing.createdAt,
      );
      const incomingIsNewer = doc.clientUpdatedAt >= existingUpdatedAt;
      const changed = hasMeaningfulChange(existing, doc);

      if (changed && incomingIsNewer) {
        toUpdate.push({
          id: existing._id,
          update: {
            $set: {
              clientTxId: doc.clientTxId,
              clientUpdatedAt: doc.clientUpdatedAt,
              Item_Barcode: doc.Item_Barcode,
              Item_Code: doc.Item_Code,
              Item_Name: doc.Item_Name,
              Frombin: doc.Frombin,
              Tobin: doc.Tobin,
              Qty: doc.Qty,
              UOM: doc.UOM,
              Timestamp: doc.Timestamp,
              Notes: doc.Notes,
              deviceId: doc.deviceId,
              Worker_Name: doc.Worker_Name,
              lastSyncedAt: now,
              syncStatus: "pending",
            },
          },
        });
        updated += 1;
      } else {
        toUpdate.push({
          id: existing._id,
          update: {
            $set: {
              clientTxId: existing.clientTxId || doc.clientTxId,
              clientUpdatedAt: existing.clientUpdatedAt || doc.clientUpdatedAt,
              ...(existing.syncStatus ? {} : { syncStatus: "pending" }),
              lastSyncedAt: now,
            },
          },
        });
        unchanged += 1;
      }
    }

    // ── BATCH WRITE: 2 round-trips max regardless of transaction count ─────────
    const writePromises = [];

    if (toInsert.length > 0) {
      const insertOp = Transaction.insertMany(toInsert, { ordered: false })
        .then((docs) => {
          for (const d of docs) sheetRows.push(d.toObject());
        })
        .catch((err) => {
          // On duplicate key errors some docs still inserted — count them
          const partial = err.result?.nInserted ?? 0;
          inserted = partial; // adjust count
        });
      writePromises.push(insertOp);
    }

    if (toUpdate.length > 0) {
      const bulkOps = toUpdate.map(({ id, update }) => ({
        updateOne: { filter: { _id: id }, update },
      }));
      writePromises.push(Transaction.bulkWrite(bulkOps, { ordered: false }));
    }

    await Promise.all(writePromises);

    await recordWorkerSync(workerName, inserted + updated);
    if (sheetRows.length > 0) {
      appendTransactions(sheetRows).catch(() => {});
    }

    // Check if there's a clear command for this worker
    const workerDoc = await WorkerSync.findOne({ worker: workerName }).lean();
    const clearBefore = workerDoc?.clearBefore
      ? workerDoc.clearBefore.toISOString()
      : null;

    res.json({
      success: true,
      synced: docs.length,
      inserted,
      updated,
      unchanged,
      locked,
      clearBefore,
    });
    // Broadcast to admin dashboards
    const broadcast = req.app.get("broadcast");
    if (broadcast && (inserted > 0 || updated > 0)) {
      broadcast("transactions_updated", { inserted, updated });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sync/verify — phone asks "which of these clientTxIds does the server have?"
// Used as a fallback: if sync POST timed out, phone calls this to mark already-synced txns.
router.post("/verify", requireDB, requireAuth, async (req, res) => {
  try {
    const { clientTxIds } = req.body;
    if (!Array.isArray(clientTxIds) || clientTxIds.length === 0) {
      return res.json({ success: true, found: [] });
    }
    const found = await Transaction.find(
      { clientTxId: { $in: clientTxIds } },
      { clientTxId: 1, _id: 0 },
    ).lean();
    res.json({ success: true, found: found.map((d) => d.clientTxId) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/", requireDB, requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      1000,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;
    const status = req.query.status || "pending";
    const query = buildStatusQuery(status);
    const sort = buildStatusSort(status);
    const mine = String(req.query.mine || "").trim() === "1";
    const worker = req.query.worker
      ? String(req.query.worker).trim().toUpperCase()
      : "";
    const isAdmin = req.user.role === "admin" || req.user.role === "superadmin";

    if (mine || !isAdmin) {
      query.Worker_Name = req.user.username;
    } else if (worker) {
      query.Worker_Name = worker;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort(sort).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(query),
    ]);

    res.json({ success: true, total, page, limit, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post(
  "/bulk-status",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
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
      // Broadcast to admin dashboards
      const broadcast = req.app.get("broadcast");
      if (broadcast && (result.modifiedCount || 0) > 0) {
        broadcast("transactions_updated", {
          updated: result.modifiedCount,
          status: nextStatus,
        });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

router.post(
  "/bulk-delete",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map((id) => String(id)).filter(Boolean))]
        : [];
      const worker = req.body?.worker
        ? String(req.body.worker).trim().toUpperCase()
        : "";

      if (ids.length > 0) {
        let deleted = 0;
        let skipped = 0;
        for (const id of ids) {
          // Never delete processed or archived — they are permanent history
          const tx = await Transaction.findOne({ _id: id }, { syncStatus: 1 }).lean();
          if (!tx) continue;
          if (["processed", "archived"].includes(tx.syncStatus)) {
            skipped++;
            continue;
          }
          const delResult = await Transaction.deleteOne({ _id: id });
          deleted += delResult.deletedCount;
        }
        return res.json({ success: true, deleted, skipped });
      }

      if (worker) {
        // Only delete pending records for this worker
        const delResult = await Transaction.deleteMany({
          Worker_Name: worker,
          syncStatus: { $nin: ["processed", "archived"] },
        });
        return res.json({ success: true, deleted: delResult.deletedCount });
      }

      return res.status(400).json({
        success: false,
        error: "Provide transaction ids or a worker name.",
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

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
    if (["processed", "archived"].includes(tx.syncStatus)) {
      return res.status(403).json({
        success: false,
        error: "Processed and archived transactions cannot be deleted. They are permanent history.",
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
    // Single aggregation pass over the collection — no full document loads
    const [statusCounts, workerAgg] = await Promise.all([
      Transaction.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$syncStatus", "pending"] },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: PENDING_QUERY },
        {
          $group: {
            _id: { $ifNull: ["$Worker_Name", "unknown"] },
            count: { $sum: 1 },
            lastTransaction: { $max: "$Timestamp" },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    const counts = { pending: 0, processed: 0, archived: 0, total: 0 };
    for (const row of statusCounts) {
      const key = ["processed", "archived"].includes(row._id)
        ? row._id
        : "pending";
      counts[key] += row.count;
      counts.total += row.count;
    }

    const workers = workerAgg.map((w) => ({
      worker: w._id,
      count: w.count,
      lastTransaction: w.lastTransaction
        ? new Date(w.lastTransaction).toISOString()
        : null,
    }));

    res.json({
      success: true,
      total: counts.pending,
      totalPending: counts.pending,
      totalProcessed: counts.processed,
      totalArchived: counts.archived,
      totalAll: counts.total,
      workers,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Clear processed data from worker phones ─────────────────────────────────

// Set clear command for specific workers (admin sets clearBefore timestamp)
router.post(
  "/clear-worker-data",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { workers } = req.body; // array of worker names, or "all"
      if (!workers) {
        return res
          .status(400)
          .json({ success: false, error: "workers is required" });
      }

      const clearBefore = new Date();
      let updated = 0;

      // "Clear Phone" only sets the clearBefore timestamp so the worker's phone
      // clears its own local history on next sync. Nothing is deleted from the
      // server — all transactions (pending, processed, archived) remain intact.
      if (workers === "all") {
        const wsResult = await WorkerSync.updateMany({}, { $set: { clearBefore } });
        updated = wsResult.modifiedCount || 0;
      } else if (Array.isArray(workers) && workers.length > 0) {
        const wsResult = await WorkerSync.updateMany(
          { worker: { $in: workers } },
          { $set: { clearBefore } },
        );
        updated = wsResult.modifiedCount || 0;
      } else {
        return res
          .status(400)
          .json({ success: false, error: "workers must be an array or 'all'" });
      }

      const workerLabel =
        workers === "all" ? "all workers" : workers.join(", ");
      audit(
        req.user?.username || "unknown",
        req.user?.role || "admin",
        "clear_worker_phone",
        workerLabel,
        `Sent phone-clear command to: ${workerLabel} (server data untouched)`,
        "admin-panel",
      );

      res.json({
        success: true,
        updated,
        serverDeleted: 0,
        clearBefore: clearBefore.toISOString(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// Worker checks for clear commands (called by app during sync)
router.get("/clear-check", requireDB, requireAuth, async (req, res) => {
  try {
    const workerName = req.user?.username;
    if (!workerName) {
      return res.json({ success: true, clearBefore: null });
    }
    const doc = await WorkerSync.findOne({ worker: workerName }).lean();
    res.json({
      success: true,
      clearBefore: doc?.clearBefore ? doc.clearBefore.toISOString() : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Worker confirms clear completed — removes the clearBefore flag
router.post("/clear-ack", requireDB, requireAuth, async (req, res) => {
  try {
    const workerName = req.user?.username;
    if (!workerName) {
      return res.json({ success: true });
    }
    await WorkerSync.updateOne(
      { worker: workerName },
      { $unset: { clearBefore: 1 } },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get(
  "/export",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { worker, json, status } = req.query;
      const query = {
        ...(worker ? { Worker_Name: worker } : {}),
        ...buildStatusQuery(status || "all"),
      };
      const sort = buildStatusSort(status || "all");
      const transactions = await Transaction.find(query).sort(sort).lean();

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
            escape(
              tx.processedAt ? new Date(tx.processedAt).toISOString() : "",
            ),
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
  },
);

router.delete("/all", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const count = await Transaction.countDocuments({});
    await Transaction.deleteMany({});
    audit(
      req.user?.username || "unknown",
      req.user?.role || "superadmin",
      "delete_all_transactions",
      "all transactions",
      `Deleted ${count} transaction(s)`,
      "superadmin-panel",
    );
    res.json({ success: true, deleted: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset all dashboard data: transactions + worker sync records (SUPER ADMIN ONLY)
router.delete(
  "/reset-all-data",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [txResult, wsResult] = await Promise.all([
        Transaction.deleteMany({}),
        WorkerSync.deleteMany({}),
      ]);
      audit(
        req.user?.username || "unknown",
        req.user?.role || "superadmin",
        "delete_all_transactions",
        "all data",
        `Reset all data: ${txResult.deletedCount} transactions, ${wsResult.deletedCount} worker syncs deleted`,
        "superadmin-panel",
      );
      res.json({
        success: true,
        deletedTransactions: txResult.deletedCount,
        deletedWorkerSyncs: wsResult.deletedCount,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

module.exports = router;
