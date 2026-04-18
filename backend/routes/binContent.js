const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const Papa = require("papaparse");
const { randomUUID } = require("crypto");
const BinContent = require("../models/BinContent");
const Item = require("../models/Item");
const Meta = require("../models/Meta");
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/authMiddleware");

// ─── Version tracking ─────────────────────────────────────────────────────────
async function getBinVersion() {
  const doc = await Meta.findOne({ key: "binContentVersion" }).lean();
  return doc ? doc.version : 0;
}

async function bumpBinVersion(req, totalHint) {
  const doc = await Meta.findOneAndUpdate(
    { key: "binContentVersion" },
    { $inc: { version: 1 } },
    { upsert: true, new: true },
  );
  // Broadcast to all connected admin dashboards
  const broadcast = req?.app?.get("broadcast");
  if (broadcast) {
    const count =
      typeof totalHint === "number"
        ? totalHint
        : await BinContent.countDocuments({});
    broadcast("bin_content_updated", {
      version: doc.version,
      totalBins: count,
    });
  }
  return doc.version;
}

// ─── Upload job tracker ───────────────────────────────────────────────────────
const binUploadJobs = new Map();
function setBinJob(jobId, patch) {
  const prev = binUploadJobs.get(jobId) || {};
  binUploadJobs.set(jobId, { ...prev, ...patch, updatedAt: Date.now() });
}

// ─── requireDB ────────────────────────────────────────────────────────────────
function requireDB(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error: "Database is not connected. Please try again shortly.",
    });
  }
  next();
}
router.use(requireDB);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────
// Accepts 4 user columns: item code, bin code, available qty, bin ranking
// normHeader strips ALL non-alphanumeric chars so headers like
//   "Item No.", "Bin Code", "Available Qty. to Take", "Bin Ranking"
// all collapse to unambiguous keys for lookup.
function normHeader(h) {
  return String(h)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseBinCsv(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error("CSV parsing failed: " + parsed.errors[0].message);
  }
  if (!parsed.data[0]) throw new Error("CSV is empty");

  // Build normHeader → original header lookup from first row
  const firstRow = parsed.data[0];
  const headerMap = {};
  for (const h of Object.keys(firstRow)) headerMap[normHeader(h)] = h;

  // Resolve required columns — ordered by most-specific match first
  // "Item No."           → normHeader → "itemno"
  // "Bin Code"           → normHeader → "bincode"
  // "Available Qty. to Take" → normHeader → "availableqtytotake"
  // "Bin Ranking"        → normHeader → "binranking"
  const COL_ITEM =
    headerMap["itemno"] || // "Item No."
    headerMap["itemcode"] || // "ItemCode"
    headerMap["itemcode"] ||
    headerMap["item"];
  const COL_BIN =
    headerMap["bincode"] || // "Bin Code" / "BinCode"
    headerMap["bin"];
  const COL_QTY =
    headerMap["availableqtytotake"] || // "Available Qty. to Take"
    headerMap["availableqty"] || // "Available Qty"
    headerMap["qty"] ||
    headerMap["quantity"];
  const COL_RANKING =
    headerMap["binranking"] || // "Bin Ranking" / "BinRanking"
    headerMap["ranking"];

  if (!COL_ITEM || !COL_BIN || !COL_QTY || !COL_RANKING) {
    throw new Error(
      "CSV must have columns: item code, bin code, available qty, bin ranking. " +
        "Got: " +
        Object.keys(firstRow).join(", "),
    );
  }

  // Use a Map keyed by "ItemCode|BinCode" to deduplicate rows.
  // One item can be in many bins; one bin can hold many items — but a CSV
  // may accidentally list the same {ItemCode, BinCode} pair more than once.
  // Last occurrence wins (matches what a fresh export would contain).
  const rowMap = new Map();
  for (const row of parsed.data) {
    const itemCode = String(row[COL_ITEM] || "").trim();
    const binCode = String(row[COL_BIN] || "").trim();
    // Strip thousands commas before parsing (e.g. "1,512.00" → 1512)
    const qty = parseFloat(String(row[COL_QTY] || "0").replace(/,/g, "")) || 0;
    const ranking = parseFloat(
      String(row[COL_RANKING] || "0").replace(/,/g, ""),
    );

    if (!itemCode || !binCode) continue;
    if (isNaN(ranking)) continue;

    rowMap.set(`${itemCode}|${binCode}`, {
      ItemCode: itemCode,
      BinCode: binCode,
      Qty: qty,
      BinRanking: ranking,
    });
  }

  const rows = Array.from(rowMap.values());
  if (rows.length === 0) throw new Error("No valid rows found in CSV");
  return rows;
}

// ─── Core CSV Apply ───────────────────────────────────────────────────────────
// Loads ENTIRE Item Master into a Map<ItemCode, {...}> ONCE — O(1) per row,
// zero per-row DB queries. Same ultra-fast principle as bulk item cache.
async function applyBinCsv(rows, mode, onProgress, req) {
  const rawCol = BinContent.collection;
  const total = rows.length;

  // Step 1: Load all Item Master once
  onProgress?.({
    processed: 0,
    total,
    inserted: 0,
    modified: 0,
    phase: "loading master",
  });
  const masterDocs = await Item.find(
    {},
    { ItemCode: 1, Barcode: 1, Item_Name: 1, CategoryCode: 1, _id: 0 },
  ).lean();
  const masterMap = new Map();
  for (const doc of masterDocs) {
    if (doc.ItemCode) masterMap.set(String(doc.ItemCode).trim(), doc);
  }

  // Step 2: Enrich every row — populate Barcode/Item_Name/CategoryCode from master
  const unresolved = [];
  const enriched = rows.map((row) => {
    const master = masterMap.get(row.ItemCode);
    if (!master) {
      unresolved.push({
        itemCode: row.ItemCode,
        binCode: row.BinCode,
        warning: "not found in Item Master",
      });
      return {
        ...row,
        Barcode: "",
        Item_Name: "",
        CategoryCode: "",
        notInMaster: true,
      };
    }
    return {
      ...row,
      Barcode: master.Barcode || "",
      Item_Name: master.Item_Name || "",
      CategoryCode: master.CategoryCode || "",
      notInMaster: false,
    };
  });
  masterMap.clear(); // free memory immediately

  const writeTime = new Date();
  let inserted = 0;
  let modified = 0;

  if (mode === "replace") {
    onProgress?.({
      processed: 0,
      total,
      inserted: 0,
      modified: 0,
      phase: "replacing",
    });
    await BinContent.deleteMany({});
    const chunks = chunkArray(enriched, 3000);
    for (const chunk of chunks) {
      const ops = chunk.map((r) => ({
        insertOne: { document: { ...r, updatedAt: writeTime } },
      }));
      const result = await rawCol.bulkWrite(ops, { ordered: false });
      inserted += result.insertedCount || 0;
      onProgress?.({
        processed: inserted,
        total,
        inserted,
        modified: 0,
        phase: "inserting",
      });
    }
    await bumpBinVersion(req, inserted);
    return { inserted, modified: 0, unchanged: 0, total, unresolved };
  }

  // Merge mode — upsert by {BinCode + ItemCode}
  onProgress?.({
    processed: 0,
    total,
    inserted: 0,
    modified: 0,
    phase: "merging",
  });
  const chunks = chunkArray(enriched, 3000);
  let processed = 0;
  for (const chunk of chunks) {
    const ops = chunk.map((r) => ({
      updateOne: {
        filter: { BinCode: r.BinCode, ItemCode: r.ItemCode },
        update: {
          $set: {
            Item_Name: r.Item_Name,
            CategoryCode: r.CategoryCode,
            Barcode: r.Barcode,
            Qty: r.Qty,
            BinRanking: r.BinRanking,
            notInMaster: r.notInMaster,
            updatedAt: writeTime,
          },
        },
        upsert: true,
      },
    }));
    const result = await rawCol.bulkWrite(ops, { ordered: false });
    inserted += result.upsertedCount || 0;
    modified += result.modifiedCount || 0;
    processed += chunk.length;
    onProgress?.({ processed, total, inserted, modified, phase: "merging" });
  }

  const totalCount = await BinContent.countDocuments({});
  await bumpBinVersion(req, totalCount);
  return { inserted, modified, unchanged: 0, total, totalCount, unresolved };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/bin-content/stats — single $facet aggregation, one DB round-trip
router.get("/stats", async (req, res) => {
  try {
    const [result] = await BinContent.aggregate([
      {
        $facet: {
          total: [{ $count: "n" }],
          upper: [{ $match: { BinRanking: { $lt: 0 } } }, { $count: "n" }],
          floor: [{ $match: { BinRanking: { $eq: 0 } } }, { $count: "n" }],
          display: [{ $match: { BinRanking: { $gt: 0 } } }, { $count: "n" }],
          unresolved: [{ $match: { notInMaster: true } }, { $count: "n" }],
          uniqueBins: [{ $group: { _id: "$BinCode" } }, { $count: "n" }],
        },
      },
    ]);
    res.json({
      success: true,
      total: result.total[0]?.n ?? 0,
      upper: result.upper[0]?.n ?? 0,
      floor: result.floor[0]?.n ?? 0,
      display: result.display[0]?.n ?? 0,
      unresolved: result.unresolved[0]?.n ?? 0,
      uniqueBins: result.uniqueBins[0]?.n ?? 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content/categories — distinct sorted category codes (for dropdown)
router.get("/categories", async (req, res) => {
  try {
    const cats = await BinContent.distinct("CategoryCode");
    const sorted = cats
      .filter((c) => c && String(c).trim() !== "")
      .sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true }),
      );
    res.json({ success: true, categories: sorted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content — paginated list with optional search + category filter
router.get("/", async (req, res) => {
  try {
    const q = req.query.q;
    const category = req.query.category
      ? String(req.query.category).trim()
      : "";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;

    let query = {};
    const conditions = [];
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      conditions.push({
        $or: [
          { BinCode: regex },
          { ItemCode: regex },
          { Item_Name: regex },
          { CategoryCode: regex },
        ],
      });
    }
    if (category) {
      conditions.push({ CategoryCode: category });
    }
    if (conditions.length === 1) query = conditions[0];
    else if (conditions.length > 1) query = { $and: conditions };

    const [bins, total, qtyAgg] = await Promise.all([
      BinContent.find(query, {
        _id: 1,
        BinCode: 1,
        ItemCode: 1,
        Item_Name: 1,
        CategoryCode: 1,
        Barcode: 1,
        Qty: 1,
        BinRanking: 1,
        notInMaster: 1,
      })
        .sort({ BinCode: 1, ItemCode: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BinContent.countDocuments(query),
      BinContent.aggregate([
        { $match: query },
        { $group: { _id: null, totalQty: { $sum: "$Qty" } } },
      ]),
    ]);
    const totalQty = qtyAgg[0]?.totalQty ?? 0;
    res.json({ success: true, bins, total, page, limit, totalQty });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bin-content — add single record (auto-lookup Item Master)
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { BinCode, ItemCode, Qty, BinRanking } = req.body;
    if (!BinCode || !ItemCode || BinRanking === undefined) {
      return res.status(400).json({
        success: false,
        error: "BinCode, ItemCode, and BinRanking are required",
      });
    }

    const master = await Item.findOne(
      { ItemCode: String(ItemCode).trim() },
      { Barcode: 1, Item_Name: 1, CategoryCode: 1, _id: 0 },
    ).lean();

    const record = {
      BinCode: String(BinCode).trim(),
      ItemCode: String(ItemCode).trim(),
      Barcode: master?.Barcode || "",
      Item_Name: master?.Item_Name || "",
      CategoryCode: master?.CategoryCode || "",
      Qty: Number(Qty) || 0,
      BinRanking: Number(BinRanking),
      notInMaster: !master,
      updatedAt: new Date(),
    };

    const doc = await BinContent.findOneAndUpdate(
      { BinCode: record.BinCode, ItemCode: record.ItemCode },
      { $set: record },
      { upsert: true, new: true },
    );
    await bumpBinVersion(req);
    res.status(201).json({
      success: true,
      bin: doc,
      unresolvedWarning: !master ? "ItemCode not found in Item Master" : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/bin-content/:id — update a single record
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { Qty, BinRanking, BinCode, ItemCode } = req.body;
    const update = { updatedAt: new Date() };
    if (Qty !== undefined) update.Qty = Number(Qty);
    if (BinRanking !== undefined) update.BinRanking = Number(BinRanking);
    if (BinCode) update.BinCode = String(BinCode).trim();
    if (ItemCode) {
      update.ItemCode = String(ItemCode).trim();
      const master = await Item.findOne(
        { ItemCode: update.ItemCode },
        { Barcode: 1, Item_Name: 1, CategoryCode: 1, _id: 0 },
      ).lean();
      update.Barcode = master?.Barcode || "";
      update.Item_Name = master?.Item_Name || "";
      update.CategoryCode = master?.CategoryCode || "";
      update.notInMaster = !master;
    }
    const doc = await BinContent.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true },
    );
    if (!doc)
      return res
        .status(404)
        .json({ success: false, error: "Record not found" });
    await bumpBinVersion(req);
    res.json({ success: true, bin: doc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/bin-content/all — superadmin only: wipe all bin records
// Must be registered BEFORE /:id so Express doesn't treat "all" as an id
router.delete("/all", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const count = await BinContent.countDocuments({});
    await BinContent.deleteMany({});
    await bumpBinVersion(req, 0);
    res.json({ success: true, deleted: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/bin-content/:id — delete a single record
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await BinContent.findByIdAndDelete(req.params.id);
    if (!doc)
      return res
        .status(404)
        .json({ success: false, error: "Record not found" });
    await bumpBinVersion(req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bin-content/upload-csv-async — async upload with job-id polling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post(
  "/upload-csv-async",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No file uploaded" });
      }
      const mode = req.query.mode === "merge" ? "merge" : "replace";
      const csvText = req.file.buffer.toString("utf8");
      const jobId = randomUUID();

      setBinJob(jobId, {
        status: "queued",
        mode,
        processed: 0,
        total: 0,
        inserted: 0,
        modified: 0,
        unchanged: 0,
        error: null,
        unresolved: [],
      });

      setImmediate(async () => {
        try {
          const rows = parseBinCsv(csvText);
          setBinJob(jobId, {
            status: "processing",
            total: rows.length,
            processed: 0,
          });
          const result = await applyBinCsv(
            rows,
            mode,
            (progress) =>
              setBinJob(jobId, { status: "processing", ...progress }),
            req,
          );
          setBinJob(jobId, { status: "done", ...result });
        } catch (err) {
          setBinJob(jobId, { status: "error", error: err.message });
        }
      });

      return res.json({ success: true, jobId });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/bin-content/upload-csv-status/:jobId — poll job progress
router.get(
  "/upload-csv-status/:jobId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const job = binUploadJobs.get(req.params.jobId);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, error: "Upload job not found" });
    }
    return res.json({ success: true, ...job });
  },
);

module.exports = router;
