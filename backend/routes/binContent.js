const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const Papa = require("papaparse");
const { randomUUID } = require("crypto");
const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);
const BinContent = require("../models/BinContent");
const Item = require("../models/Item");
const BinMaster = require("../models/BinMaster");
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
  // Invalidate pre-gzipped bulk cache so next download gets fresh data
  invalidateBinBulkCache();
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

// Derive a human-readable zone label from BinRanking when BinMaster ZoneCode is absent.
function rankingToZone(ranking) {
  if (ranking > 0) return "Display";
  if (ranking < 0) return "Upper";
  return "Floor";
}

// Derive Aisle and Chamber from a BinCode.
// Chamber A: A1–A12, Chamber B: B13–B24, Chamber C: C25–C36
// High Value: HV01, HV02, ...   Bulk Warehouse: WH01, WH02, ...
function deriveAisleAndChamber(binCode) {
  if (!binCode) return { aisle: null, chamber: null };
  const code = String(binCode).trim().toUpperCase();
  if (/^HV\d+$/.test(code)) return { aisle: null, chamber: "High Value" };
  if (/^WH\d+$/.test(code)) return { aisle: null, chamber: "Bulk Warehouse" };
  const m = code.match(/^([ABC])(\d{1,2})\d{4}[A-Z]$/);
  if (!m) return { aisle: null, chamber: null };
  const letter = m[1];
  const num = parseInt(m[2], 10);
  const aisle = letter + num;
  if (letter === "A" && num >= 1 && num <= 12)
    return { aisle, chamber: "Chamber A" };
  if (letter === "B" && num >= 13 && num <= 24)
    return { aisle, chamber: "Chamber B" };
  if (letter === "C" && num >= 25 && num <= 36)
    return { aisle, chamber: "Chamber C" };
  return { aisle, chamber: null };
}

// Chamber → BinCode prefix regex mapping (for query filter)
const CHAMBER_REGEX_MAP = {
  "Chamber A": /^A/,
  "Chamber B": /^B/,
  "Chamber C": /^C/,
  "High Value": /^HV/,
  "Bulk Warehouse": /^WH/,
};

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
    headerMap["binranking"] || // "Bin Ranking" / "BinRanking" (optional — BinMaster is authoritative)
    headerMap["ranking"] ||
    null;

  if (!COL_ITEM || !COL_BIN || !COL_QTY) {
    throw new Error(
      "CSV must have columns: item code, bin code, available qty. " +
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
    // Ranking from CSV is optional — BinMaster overrides it in applyBinCsv
    const ranking = COL_RANKING
      ? parseFloat(String(row[COL_RANKING] || "0").replace(/,/g, "")) || 0
      : 0;

    if (!itemCode || !binCode) continue;

    rowMap.set(`${itemCode}|${binCode}`, {
      ItemCode: itemCode,
      BinCode: binCode,
      Qty: qty,
      BinRanking: ranking, // may be 0; BinMaster lookup in applyBinCsv will override
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

  // Step 1: Load all Item Master + BinMaster once (parallel)
  onProgress?.({
    processed: 0,
    total,
    inserted: 0,
    modified: 0,
    phase: "loading master",
  });
  const [masterDocs, binMasterDocs] = await Promise.all([
    Item.find(
      {},
      { ItemCode: 1, Barcode: 1, Item_Name: 1, CategoryCode: 1, _id: 0 },
    ).lean(),
    BinMaster.find(
      {},
      { BinCode: 1, BinRanking: 1, ZoneCode: 1, _id: 0 },
    ).lean(),
  ]);
  const masterMap = new Map();
  for (const doc of masterDocs) {
    if (doc.ItemCode) masterMap.set(String(doc.ItemCode).trim(), doc);
  }
  // BinMaster is authoritative for BinRanking and ZoneCode
  const binMasterMap = new Map();
  for (const doc of binMasterDocs) {
    if (doc.BinCode) binMasterMap.set(String(doc.BinCode).trim(), doc);
  }

  // Step 2: Enrich every row — Item Master for name/barcode/category, BinMaster for ranking/zone
  const unresolved = [];
  const enriched = rows.map((row) => {
    const master = masterMap.get(row.ItemCode);
    const binMaster = binMasterMap.get(row.BinCode);
    // BinMaster wins for BinRanking and ZoneCode; fall back to CSV values if bin not in BinMaster.
    // If BinMaster exists but its ZoneCode is empty, derive the zone from BinRanking.
    const binRanking =
      binMaster != null ? binMaster.BinRanking : row.BinRanking;
    const zoneCode =
      (binMaster && binMaster.ZoneCode) || rankingToZone(binRanking);
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
        BinRanking: binRanking,
        ZoneCode: zoneCode,
        notInMaster: true,
      };
    }
    return {
      ...row,
      Barcode: master.Barcode || "",
      Item_Name: master.Item_Name || "",
      CategoryCode: master.CategoryCode || "",
      BinRanking: binRanking,
      ZoneCode: zoneCode,
      notInMaster: false,
    };
  });
  masterMap.clear();
  binMasterMap.clear(); // free memory

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
            ZoneCode: r.ZoneCode,
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

// ─── Bulk Download Cache ──────────────────────────────────────────────────────
// Pre-gzipped buffer built once per bin-content version. Serves many phones from RAM.
let _binBulkCache = { version: null, gzBuf: null, etag: null };
let _binBuildPromise = null;

async function _buildBinBulkCache() {
  const [bins, version] = await Promise.all([
    BinContent.find({}, { _id: 0, BinCode: 1, ItemCode: 1, Qty: 1 })
      .sort({ BinCode: 1, ItemCode: 1 })
      .lean(),
    getBinVersion(),
  ]);
  const payload = JSON.stringify({
    success: true,
    version,
    total: bins.length,
    items: bins,
  });
  const gzBuf = await gzip(Buffer.from(payload, "utf8"), { level: 6 });
  _binBulkCache = { version, gzBuf, etag: `"binv${version}"` };
  console.log(
    `[bin-cache] built v${version} — ${bins.length} records, ${(gzBuf.length / 1024).toFixed(0)} KB gzipped`,
  );
  return _binBulkCache;
}

async function getBinBulkCache() {
  const currentVersion = await getBinVersion();
  if (_binBulkCache.version === currentVersion && _binBulkCache.gzBuf)
    return _binBulkCache;
  if (!_binBuildPromise) {
    _binBuildPromise = _buildBinBulkCache().finally(() => {
      _binBuildPromise = null;
    });
  }
  return _binBuildPromise;
}

function invalidateBinBulkCache() {
  _binBulkCache = { version: null, gzBuf: null, etag: null };
  _binBuildPromise = null;
  invalidateBinMetaCache();
}

// ─── Meta Cache (categories + zoneCodes + stats) ──────────────────────────────
// Built once per version, served from RAM in <1ms. Invalidated on every write.
// Reduces 3 HTTP round-trips (categories + zones + stats) to 1 on screen open.
let _binMetaCache = { version: null, data: null };
let _binMetaBuildPromise = null;

async function _buildBinMetaCache() {
  const version = await getBinVersion();
  const [result, categories, zoneCodes] = await Promise.all([
    BinContent.aggregate([
      {
        $facet: {
          total: [{ $count: "n" }],
          upper: [{ $match: { BinRanking: { $lt: 0 } } }, { $count: "n" }],
          floor: [{ $match: { BinRanking: { $eq: 0 } } }, { $count: "n" }],
          display: [{ $match: { BinRanking: { $gt: 0 } } }, { $count: "n" }],
          unresolved: [{ $match: { notInMaster: true } }, { $count: "n" }],
          uniqueBins: [{ $group: { _id: "$BinCode" } }, { $count: "n" }],
          uniqueItems: [{ $group: { _id: "$ItemCode" } }, { $count: "n" }],
          totalQty: [{ $group: { _id: null, sum: { $sum: "$Qty" } } }],
        },
      },
    ]),
    BinContent.distinct("CategoryCode"),
    BinContent.distinct("ZoneCode"),
  ]);
  const r = result[0] || {};
  const stats = {
    success: true,
    total: r.total?.[0]?.n ?? 0,
    upper: r.upper?.[0]?.n ?? 0,
    floor: r.floor?.[0]?.n ?? 0,
    display: r.display?.[0]?.n ?? 0,
    unresolved: r.unresolved?.[0]?.n ?? 0,
    uniqueBins: r.uniqueBins?.[0]?.n ?? 0,
    uniqueItems: r.uniqueItems?.[0]?.n ?? 0,
    totalQty: r.totalQty?.[0]?.sum ?? 0,
  };
  const sortedCats = categories
    .filter((c) => c && String(c).trim() !== "")
    .sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true }),
    );
  const sortedZones = zoneCodes
    .filter((c) => c && String(c).trim() !== "")
    .sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true }),
    );

  _binMetaCache = {
    version,
    data: {
      success: true,
      stats,
      categories: sortedCats,
      zoneCodes: sortedZones,
    },
  };
  console.log(
    `[bin-meta-cache] built v${version} — ${sortedCats.length} cats, ${sortedZones.length} zones`,
  );
  return _binMetaCache;
}

async function getBinMetaCache() {
  const currentVersion = await getBinVersion();
  if (_binMetaCache.version === currentVersion && _binMetaCache.data)
    return _binMetaCache;
  if (!_binMetaBuildPromise) {
    _binMetaBuildPromise = _buildBinMetaCache().finally(() => {
      _binMetaBuildPromise = null;
    });
  }
  return _binMetaBuildPromise;
}

function invalidateBinMetaCache() {
  _binMetaCache = { version: null, data: null };
  _binMetaBuildPromise = null;
}

// GET /api/bin-content/version — lightweight version check for phones
router.get("/version", async (req, res) => {
  try {
    const [version, total] = await Promise.all([
      getBinVersion(),
      BinContent.countDocuments({}),
    ]);
    res.json({ success: true, version, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content/bulk — pre-gzipped full dump for phone sync
router.get("/bulk", async (req, res) => {
  try {
    const cache = await getBinBulkCache();

    // 304 Not Modified — phone already has this version
    if (req.headers["if-none-match"] === cache.etag) {
      return res.status(304).end();
    }

    res.locals.noCompress = true;
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      ETag: cache.etag,
      "Cache-Control": "no-cache",
      "Content-Length": cache.gzBuf.length,
    });
    return res.end(cache.gzBuf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content/delta?since=<ISO> — incremental sync
router.get("/delta", async (req, res) => {
  try {
    const sinceRaw = req.query.since;
    if (!sinceRaw) {
      return res
        .status(400)
        .json({ success: false, error: "since param required" });
    }
    const since = new Date(sinceRaw);
    if (isNaN(since.getTime())) {
      return res
        .status(400)
        .json({ success: false, error: "invalid since date" });
    }

    const [version, items] = await Promise.all([
      getBinVersion(),
      BinContent.find(
        { updatedAt: { $gt: since } },
        { _id: 0, BinCode: 1, ItemCode: 1, Qty: 1 },
      )
        .sort({ BinCode: 1 })
        .lean(),
    ]);

    res.json({
      success: true,
      version,
      serverTime: new Date().toISOString(),
      total: items.length,
      items,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content/by-item/:itemCode — all bins for a specific item
router.get("/by-item/:itemCode", async (req, res) => {
  try {
    const itemCode = String(req.params.itemCode).trim();
    if (!itemCode) {
      return res
        .status(400)
        .json({ success: false, error: "itemCode is required" });
    }
    const bins = await BinContent.find(
      { ItemCode: itemCode },
      { _id: 0, BinCode: 1, Qty: 1, BinRanking: 1, ZoneCode: 1 },
    )
      .sort({ Qty: -1 })
      .lean();
    res.json({ success: true, bins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
          uniqueItems: [{ $group: { _id: "$ItemCode" } }, { $count: "n" }],
          totalQty: [{ $group: { _id: null, sum: { $sum: "$Qty" } } }],
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
      uniqueItems: result.uniqueItems[0]?.n ?? 0,
      totalQty: result.totalQty[0]?.sum ?? 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content/meta — ONE request: stats + categories + zones (RAM-cached)
// Replaces 3 separate round-trips on screen open. Built once, served in <1ms.
router.get("/meta", async (req, res) => {
  try {
    const cache = await getBinMetaCache();
    res.set("Cache-Control", "no-cache");
    res.json(cache.data);
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

// GET /api/bin-content/zone-codes — distinct sorted zone codes (for dropdown)
router.get("/zone-codes", async (req, res) => {
  try {
    const codes = await BinContent.distinct("ZoneCode");
    const sorted = codes
      .filter((c) => c && String(c).trim() !== "")
      .sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true }),
      );
    res.json({ success: true, zoneCodes: sorted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-content/chambers — fixed list of chamber labels
router.get("/chambers", (req, res) => {
  res.json({
    success: true,
    chambers: [
      "Chamber A",
      "Chamber B",
      "Chamber C",
      "High Value",
      "Bulk Warehouse",
    ],
  });
});

// GET /api/bin-content — paginated list with optional search + multi-filters + sort
router.get("/", async (req, res) => {
  try {
    const q = req.query.q;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;

    // Multi-value filters: comma-separated strings
    const parseList = (v) =>
      v
        ? String(v)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const categories = parseList(req.query.categories || req.query.category);
    const zoneCodes = parseList(req.query.zoneCodes || req.query.zoneCode);
    // zones = Display | Floor | Upper — maps to BinRanking comparison
    const zones = parseList(req.query.zones || req.query.zone);
    // chambers = Chamber A | Chamber B | Chamber C | High Value | Bulk Warehouse
    const chambers = parseList(req.query.chambers || req.query.chamber);

    // Sort: field_direction, e.g. BinCode_asc, Qty_desc
    const SORT_MAP = {
      BinCode_asc: { BinCode: 1 },
      BinCode_desc: { BinCode: -1 },
      ItemCode_asc: { ItemCode: 1 },
      ItemCode_desc: { ItemCode: -1 },
      Category_asc: { CategoryCode: 1 },
      Category_desc: { CategoryCode: -1 },
      Qty_asc: { Qty: 1 },
      Qty_desc: { Qty: -1 },
      Ranking_asc: { BinRanking: 1 },
      Ranking_desc: { BinRanking: -1 },
    };
    const sortParam = req.query.sort || "BinCode_asc";
    const sortObj = SORT_MAP[sortParam] || { BinCode: 1, ItemCode: 1 };

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
    if (categories.length === 1) {
      conditions.push({ CategoryCode: categories[0] });
    } else if (categories.length > 1) {
      conditions.push({ CategoryCode: { $in: categories } });
    }
    if (zoneCodes.length === 1) {
      conditions.push({ ZoneCode: zoneCodes[0] });
    } else if (zoneCodes.length > 1) {
      conditions.push({ ZoneCode: { $in: zoneCodes } });
    }
    if (zones.length > 0) {
      const zoneConditions = zones.map((z) => {
        if (z === "Display") return { BinRanking: { $gt: 0 } };
        if (z === "Upper") return { BinRanking: { $lt: 0 } };
        return { BinRanking: 0 }; // Floor
      });
      conditions.push(
        zoneConditions.length === 1
          ? zoneConditions[0]
          : { $or: zoneConditions },
      );
    }
    if (chambers.length > 0) {
      const chamberConditions = chambers
        .map((c) => CHAMBER_REGEX_MAP[c])
        .filter(Boolean)
        .map((rx) => ({ BinCode: rx }));
      if (chamberConditions.length > 0) {
        conditions.push(
          chamberConditions.length === 1
            ? chamberConditions[0]
            : { $or: chamberConditions },
        );
      }
    }
    if (req.query.notInMaster === "1") {
      conditions.push({ notInMaster: true });
    }

    let query = {};
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
        ZoneCode: 1,
        notInMaster: 1,
      })
        .sort(sortObj)
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
    // Enrich each bin with derived Aisle and Chamber
    const enriched = bins.map((b) => {
      const { aisle, chamber } = deriveAisleAndChamber(b.BinCode);
      return { ...b, Aisle: aisle, Chamber: chamber };
    });
    res.json({ success: true, bins: enriched, total, page, limit, totalQty });
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
module.exports._warmBinMetaCache = async () => {
  try {
    await getBinMetaCache();
  } catch (e) {
    console.warn("[bin-meta-cache] warm failed:", e.message);
  }
};
