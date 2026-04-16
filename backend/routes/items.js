const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const Papa = require("papaparse");
const { randomUUID } = require("crypto");
const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);
const Item = require("../models/Item");
const Meta = require("../models/Meta");
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/authMiddleware");
const AuditLog = require("../models/AuditLog");

// ─── Bulk Download Cache ──────────────────────────────────────────────────────
// Pre-gzipped buffer built once per item-version. Serves 70-80 phones from RAM.
// All concurrent cold-start requests coalesce on the single build promise.
let _bulkCache = { version: null, gzBuf: null, etag: null };
let _buildPromise = null;

async function _buildBulkCache() {
  const [items, version] = await Promise.all([
    Item.find({}, { _id: 0, ItemCode: 1, Barcode: 1, Item_Name: 1, UOM: 1 })
      .sort({ Item_Name: 1 })
      .lean(),
    getItemsVersion(),
  ]);
  const payload = JSON.stringify({ success: true, version, total: items.length, items });
  const gzBuf = await gzip(Buffer.from(payload, "utf8"), { level: 6 });
  _bulkCache = { version, gzBuf, etag: `"v${version}"` };
  console.log(`[items-cache] built v${version} — ${items.length} items, ${(gzBuf.length / 1024).toFixed(0)} KB gzipped`);
  return _bulkCache;
}

// Public: returns cache, building it if needed. Concurrent callers share one build.
async function getBulkCache() {
  const currentVersion = await getItemsVersion();
  if (_bulkCache.version === currentVersion && _bulkCache.gzBuf) return _bulkCache;
  if (!_buildPromise) {
    _buildPromise = _buildBulkCache().finally(() => { _buildPromise = null; });
  }
  return _buildPromise;
}

// Call this whenever items change (invalidates cache immediately)
function invalidateBulkCache() {
  _bulkCache = { version: null, gzBuf: null, etag: null };
  _buildPromise = null;
}

// Warm the cache after server start (so first phone gets fast response too)
async function warmBulkCache() {
  try {
    await getBulkCache();
  } catch (e) {
    console.warn("[items-cache] warm failed:", e.message);
  }
}
module.exports._warmBulkCache = warmBulkCache;

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

// Apply requireDB to all routes in this router
router.use(requireDB);

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

const REPLACE_INSERT_CHUNK = 40000;
const REPLACE_INSERT_PARALLEL = 4;
const ITEM_INDEX_DEFS = [
  { key: { Barcode: 1 }, name: "Barcode_1", unique: true, background: true },
  { key: { Item_Name: 1 }, name: "Item_Name_1", background: true },
  { key: { ItemCode: 1 }, name: "ItemCode_1", background: true },
];

const uploadJobs = new Map();

function setUploadJob(jobId, patch) {
  const prev = uploadJobs.get(jobId) || {};
  uploadJobs.set(jobId, { ...prev, ...patch, updatedAt: Date.now() });
}

// ─── Merge Diff Reports ───────────────────────────────────────────────────────
// Stores per-item categorization from the last merge so admin can download CSVs.
// Kept for 2 hours then auto-cleaned.
const mergeReports = new Map();

function storeMergeReport(mergeId, report) {
  mergeReports.set(mergeId, { ...report, createdAt: Date.now() });
  // Auto-clean after 2 hours
  setTimeout(() => mergeReports.delete(mergeId), 2 * 60 * 60 * 1000);
}

// Clean stale reports older than 2 hours on startup too
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, r] of mergeReports) {
    if (r.createdAt < cutoff) mergeReports.delete(id);
  }
}, 30 * 60 * 1000);

function parseCsvItems(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error("CSV parsing failed: " + parsed.errors[0].message);
  }

  const firstRow = parsed.data[0];
  if (!firstRow) {
    throw new Error("CSV is empty");
  }

  const hasNewFormat = "Barcode" in firstRow && "Item_Name" in firstRow;
  const hasOldFormat =
    "Barcode No." in firstRow && "Item Description" in firstRow;

  if (!hasNewFormat && !hasOldFormat) {
    throw new Error(
      "CSV must have headers: ItemCode, Barcode, Item_Name (or Item No., Barcode No., Item Description)",
    );
  }

  const dedup = new Map();
  for (const row of parsed.data) {
    const rawBarcode = hasOldFormat ? row["Barcode No."] : row.Barcode;
    const rawName = hasOldFormat ? row["Item Description"] : row.Item_Name;
    if (!rawBarcode || !rawName) continue;

    const barcode = String(rawBarcode).trim();
    const itemName = String(rawName).trim();
    if (!barcode || !itemName) continue;

    dedup.set(barcode, {
      ItemCode: String(
        hasOldFormat ? row["Item No."] || rawBarcode : row.ItemCode || rawBarcode,
      ).trim(),
      Barcode: barcode,
      Item_Name: itemName,
      UOM: "PCS",
    });
  }
  const items = Array.from(dedup.values());

  if (items.length === 0) {
    throw new Error("No valid rows found in CSV");
  }
  return items;
}

async function dropCollectionIfExists(collection) {
  try {
    await collection.drop();
  } catch (e) {
    if (e.codeName !== "NamespaceNotFound") throw e;
  }
}

async function createItemIndexes(collection) {
  await collection.createIndexes(ITEM_INDEX_DEFS);
}

async function bulkInsertReplaceItems(items, collection, onProgress) {
  const total = items.length;
  let inserted = 0;
  let processed = 0;
  const chunks = chunkArray(items, REPLACE_INSERT_CHUNK);

  onProgress?.({
    processed: 0,
    total,
    inserted: 0,
    modified: 0,
    phase: "inserting",
  });

  for (let i = 0; i < chunks.length; i += REPLACE_INSERT_PARALLEL) {
    const batch = chunks.slice(i, i + REPLACE_INSERT_PARALLEL);
    const results = await Promise.all(
      batch.map((chunk) =>
        collection
          .insertMany(chunk, {
            ordered: false,
            writeConcern: { w: 1, j: false },
            bypassDocumentValidation: true,
          })
          .then((r) => r.insertedCount)
          .catch(
            (err) =>
              err.result?.nInserted ??
              chunk.length - (err.writeErrors?.length || 0),
          ),
      ),
    );
    for (const count of results) inserted += count;
    processed += batch.reduce((sum, chunk) => sum + chunk.length, 0);
    onProgress?.({
      processed,
      total,
      inserted,
      modified: 0,
      phase: "inserting",
    });
  }

  return { inserted, processed, total };
}

async function replaceItemsAtomically(items, onProgress) {
  const db = mongoose.connection.db;
  const liveName = Item.collection.collectionName;
  const tempName = `${liveName}_upload_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const tempCol = db.collection(tempName);
  const total = items.length;

  try {
    await dropCollectionIfExists(tempCol);
    const { inserted } = await bulkInsertReplaceItems(items, tempCol, onProgress);
    onProgress?.({
      processed: total,
      total,
      inserted,
      modified: 0,
      phase: "indexing",
    });
    await createItemIndexes(tempCol);
    await tempCol.rename(liveName, { dropTarget: true });
    return { inserted, modified: 0, totalItems: total, processed: total, total };
  } catch (err) {
    try {
      await dropCollectionIfExists(tempCol);
    } catch (_) {}
    throw err;
  }
}

async function applyCsvItems(items, mode, onProgress, req, mergeId) {
  const rawCol = Item.collection; // raw MongoDB driver — skips Mongoose overhead
  const total = items.length;

  if (mode === "replace") {
    const result = await replaceItemsAtomically(items, onProgress);
    await Promise.all([
      bumpItemsVersion(req, result.totalItems),
      setLastFullReplace(),
    ]);
    return result;
  }

  // ── Merge mode — pre-fetch existing (only CSV barcodes), compare, upsert ──

  // Step 1: Load only items whose barcodes appear in the CSV — not the full collection.
  // A full scan of 1.6M items costs 300-500 MB and crashes the server on Render free tier.
  // Querying only the CSV barcodes (chunked $in) keeps peak RAM proportional to CSV size.
  onProgress?.({ processed: 0, total, inserted: 0, modified: 0, phase: "scanning" });
  const csvBarcodes = items.map((item) => item.Barcode);
  const SCAN_CHUNK = 10000;
  const existingMap = new Map(); // Barcode → { ItemCode, Item_Name, UOM }
  for (let i = 0; i < csvBarcodes.length; i += SCAN_CHUNK) {
    const batch = csvBarcodes.slice(i, i + SCAN_CHUNK);
    const docs = await rawCol
      .find(
        { Barcode: { $in: batch } },
        { projection: { Barcode: 1, ItemCode: 1, Item_Name: 1, UOM: 1, _id: 0 } },
      )
      .toArray();
    for (const doc of docs) {
      existingMap.set(doc.Barcode, {
        ItemCode: doc.ItemCode || "",
        Item_Name: doc.Item_Name || "",
        UOM: doc.UOM || "PCS",
      });
    }
    onProgress?.({
      processed: Math.min(i + SCAN_CHUNK, total),
      total,
      inserted: 0,
      modified: 0,
      phase: "scanning",
    });
  }

  // Step 2: Categorize every CSV item — new / updated / unchanged
  const newItems = [];
  const updatedItems = [];
  const unchangedItems = [];

  for (const item of items) {
    const ex = existingMap.get(item.Barcode);
    if (!ex) {
      newItems.push(item);
    } else {
      const uom = item.UOM || "PCS";
      if (
        ex.ItemCode !== (item.ItemCode || "") ||
        ex.Item_Name !== (item.Item_Name || "") ||
        ex.UOM !== uom
      ) {
        updatedItems.push(item);
      } else {
        unchangedItems.push(item);
      }
    }
  }
  existingMap.clear(); // free memory immediately after categorization

  // Step 3: Only write items that are new or actually changed
  const itemsToWrite = [...newItems, ...updatedItems];
  let inserted = 0;
  let modified = 0;
  let processed = 0;
  const CHUNK = 5000;
  const chunks = chunkArray(itemsToWrite, CHUNK);
  const mergeTime = new Date();

  for (const chunk of chunks) {
    const ops = chunk.map((item) => ({
      updateOne: {
        filter: { Barcode: item.Barcode },
        update: {
          $set: {
            ItemCode: item.ItemCode,
            Barcode: item.Barcode,
            Item_Name: item.Item_Name,
            UOM: item.UOM || "PCS",
            updatedAt: mergeTime,
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

  // Step 4: Store diff report in memory so admin can download CSVs by status
  if (mergeId) {
    storeMergeReport(mergeId, {
      new: newItems,
      updated: updatedItems,
      unchanged: unchangedItems,
    });
  }

  const totalItems = await Item.countDocuments({});
  await bumpItemsVersion(req, totalItems);
  return {
    inserted,
    modified,
    unchanged: unchangedItems.length,
    totalItems,
    processed: total,
    total,
    mergeId: mergeId || null,
  };
}

// ─── Item Version Tracking ──────────────────────────────────────────────────
// Always read from MongoDB so multiple server instances stay in sync.

async function getItemsVersion() {
  const doc = await Meta.findOne({ key: "itemsVersion" }).lean();
  return doc ? doc.version : 0;
}

async function setLastFullReplace() {
  await Meta.findOneAndUpdate(
    { key: "lastFullReplace" },
    { $set: { value: new Date() } },
    { upsert: true },
  );
}

async function getLastFullReplace() {
  const doc = await Meta.findOne({ key: "lastFullReplace" }).lean();
  return doc?.value ? new Date(doc.value) : null;
}

async function bumpItemsVersion(req, totalItemsHint) {
  const doc = await Meta.findOneAndUpdate(
    { key: "itemsVersion" },
    { $inc: { version: 1 } },
    { upsert: true, new: true },
  );
  invalidateBulkCache(); // drop stale cache immediately
  // Broadcast to all connected admin dashboards
  const broadcast = req?.app?.get("broadcast");
  if (broadcast) {
    const count =
      typeof totalItemsHint === "number"
        ? totalItemsHint
        : await Item.countDocuments({});
    broadcast("items_updated", { version: doc.version, totalItems: count });
  }
  // Rebuild cache in background so next phone request is instant
  getBulkCache().catch(() => {});
  return doc.version;
}

// GET /api/items/version — lightweight check for phones (no auth needed)
router.get("/version", async (req, res) => {
  const [count, version] = await Promise.all([
    Item.countDocuments({}),
    getItemsVersion(),
  ]);
  res.json({ success: true, version, totalItems: count });
});

// GET /api/items/bulk — ultra-fast cached bulk download for phones
// First request after a version change builds the cache (~2s), all others serve from RAM (<50ms).
// Phones sending If-None-Match with current ETag get 304 instantly (skip the download entirely).
router.get("/bulk", async (req, res) => {
  try {
    const cache = await getBulkCache();

    // 304 Not Modified — phone already has this version, skip the download
    if (req.headers["if-none-match"] === cache.etag) {
      return res.status(304).end();
    }

    // Disable express compression middleware — we serve a pre-gzipped buffer
    res.locals.noCompress = true;
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "ETag": cache.etag,
      "Cache-Control": "no-cache",
      "Content-Length": cache.gzBuf.length,
    });
    return res.end(cache.gzBuf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/items/delta?since=<ISO>&lastFullSync=<ISO>
// Returns only items created/updated after `since`.
// If lastFullSync is before the last full-replace, phone must do a full re-download.
// Small payload (200-1000 items/day) — served directly, no pre-caching needed.
router.get("/delta", async (req, res) => {
  try {
    const sinceRaw = req.query.since;
    const lastFullSyncRaw = req.query.lastFullSync;

    if (!sinceRaw) {
      return res.status(400).json({ success: false, error: "since param required" });
    }

    const since = new Date(sinceRaw);
    if (isNaN(since.getTime())) {
      return res.status(400).json({ success: false, error: "invalid since date" });
    }

    const serverTime = new Date();
    const [version, lastFullReplace] = await Promise.all([
      getItemsVersion(),
      getLastFullReplace(),
    ]);

    // If admin did a full replace after the phone's last full sync → force full download
    if (lastFullReplace && lastFullSyncRaw) {
      const lastFullSync = new Date(lastFullSyncRaw);
      if (!isNaN(lastFullSync.getTime()) && lastFullReplace > lastFullSync) {
        return res.json({
          success: true,
          version,
          serverTime: serverTime.toISOString(),
          requiresFullSync: true,
          items: [],
          total: 0,
        });
      }
    }

    const items = await Item.find(
      { updatedAt: { $gte: since } },
      { _id: 0, ItemCode: 1, Barcode: 1, Item_Name: 1, UOM: 1 },
    ).lean();

    return res.json({
      success: true,
      version,
      serverTime: serverTime.toISOString(),
      requiresFullSync: false,
      items,
      total: items.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/push-master — admin explicitly pushes current master to all phones
// Bumps version so phones know to re-download
router.post("/push-master", requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await Item.countDocuments({});
    if (count === 0) {
      return res.status(400).json({
        success: false,
        error: "No items in database. Upload a CSV first.",
      });
    }
    const newVersion = await bumpItemsVersion(req);
    res.json({ success: true, version: newVersion, totalItems: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/items/count — fast count without fetching all docs
router.get("/count", async (req, res) => {
  try {
    const count = await Item.countDocuments({});
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/items — return all items
router.get("/", async (req, res) => {
  try {
    const { q } = req.query;
    const paginated = String(req.query.paginated || "0") === "1";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      5000,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;
    let query = {};
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query = {
        $or: [{ Item_Name: regex }, { Barcode: regex }, { ItemCode: regex }],
      };
    }

    if (paginated) {
      const [items, total] = await Promise.all([
        Item.find(query)
          .select("ItemCode Barcode Item_Name UOM")
          .sort({ Item_Name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Item.countDocuments(query),
      ]);
      return res.json({
        success: true,
        count: items.length,
        total,
        page,
        limit,
        items,
      });
    }

    const items = await Item.find(query)
      .select("ItemCode Barcode Item_Name UOM")
      .sort({ Item_Name: 1 })
      .lean();
    res.json({ success: true, count: items.length, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items — add a single item
router.post("/", async (req, res) => {
  try {
    const { ItemCode, Barcode, Item_Name } = req.body;
    if (!ItemCode || !Barcode || !Item_Name) {
      return res.status(400).json({
        success: false,
        error: "ItemCode, Barcode, and Item_Name are required",
      });
    }
    const item = await Item.findOneAndUpdate(
      { Barcode },
      { $set: { ItemCode, Barcode, Item_Name, UOM: "PCS", updatedAt: new Date() } },
      { upsert: true, new: true },
    );
    await bumpItemsVersion(req);
    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/import — bulk upsert array of items (admin only)
router.post("/import", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "items array is required" });
    }
    let inserted = 0;
    let modified = 0;
    const rawCol = Item.collection;
    const importTime = new Date();
    const chunks = chunkArray(items, 3000);
    for (const chunk of chunks) {
      const ops = chunk.map((item) => ({
        updateOne: {
          filter: { Barcode: item.Barcode },
          update: {
            $set: {
              ItemCode: item.ItemCode,
              Barcode: item.Barcode,
              Item_Name: item.Item_Name,
              updatedAt: importTime,
            },
          },
          upsert: true,
        },
      }));
      const result = await rawCol.bulkWrite(ops, { ordered: false });
      inserted += result.upsertedCount || 0;
      modified += result.modifiedCount || 0;
    }
    await bumpItemsVersion(req);
    res.json({ success: true, inserted, modified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/items/all — superadmin only: clear all items before re-import
router.delete("/all", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const count = await Item.countDocuments({});
    await Item.deleteMany({});
    await Promise.all([bumpItemsVersion(req), setLastFullReplace()]);
    audit(
      req.user?.username || "unknown",
      req.user?.role || "superadmin",
      "delete_all_items",
      "item master",
      `Deleted ${count} items from master list`,
      "superadmin-panel",
    );
    res.json({ success: true, deleted: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/replace — admin: delete all items then import fresh CSV
router.post("/replace", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "items array is required" });
    }
    const result = await applyCsvItems(items, "replace", null, req);
    res.json({ success: true, inserted: result.inserted, totalItems: result.totalItems });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/upload-csv — admin web panel: upload a CSV file
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
router.post(
  "/upload-csv",
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
      const csvText = req.file.buffer.toString("utf8");
      const mode = req.query.mode === "merge" ? "merge" : "replace";
      const items = parseCsvItems(csvText);
      const result = await applyCsvItems(items, mode, null, req);
      res.json({
        success: true,
        inserted: result.inserted,
        modified: result.modified,
        totalItems: result.totalItems,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/items/upload-csv-async — admin web panel: async CSV upload with status polling
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
      const mergeId = mode === "merge" ? randomUUID() : null;

      setUploadJob(jobId, {
        status: "queued",
        mode,
        processed: 0,
        total: 0,
        inserted: 0,
        modified: 0,
        unchanged: 0,
        error: null,
        totalItems: 0,
        mergeId,
      });

      setImmediate(async () => {
        try {
          const items = parseCsvItems(csvText);
          setUploadJob(jobId, {
            status: "processing",
            total: items.length,
            processed: 0,
          });

          const result = await applyCsvItems(
            items,
            mode,
            (progress) => {
              setUploadJob(jobId, {
                status: "processing",
                ...progress,
              });
            },
            req,
            mergeId,
          );

          setUploadJob(jobId, {
            status: "done",
            ...result,
          });
        } catch (err) {
          setUploadJob(jobId, {
            status: "error",
            error: err.message,
          });
        }
      });

      return res.json({ success: true, jobId });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/items/upload-csv-status/:jobId — admin polling endpoint for async upload
router.get(
  "/upload-csv-status/:jobId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const job = uploadJobs.get(req.params.jobId);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, error: "Upload job not found" });
    }
    return res.json({ success: true, ...job });
  },
);

// GET /api/items/merge-report/:mergeId — download diff CSV for a merge operation
// ?status=new|updated|unchanged|all  (default: all)
router.get(
  "/merge-report/:mergeId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const report = mergeReports.get(req.params.mergeId);
    if (!report) {
      return res.status(404).json({
        success: false,
        error: "Report not found or has expired (reports are kept for 2 hours)",
      });
    }

    const status = req.query.status || "all";
    let rows;
    if (status === "new") rows = report.new;
    else if (status === "updated") rows = report.updated;
    else if (status === "unchanged") rows = report.unchanged;
    else rows = [
      ...report.new.map((r) => ({ ...r, Status: "New" })),
      ...report.updated.map((r) => ({ ...r, Status: "Updated" })),
      ...report.unchanged.map((r) => ({ ...r, Status: "Unchanged" })),
    ];

    // Add Status column for single-status downloads too
    if (status !== "all") {
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      rows = rows.map((r) => ({ ...r, Status: label }));
    }

    const header = "Status,ItemCode,Barcode,Item_Name,UOM\n";
    const body = rows
      .map((r) => {
        const s = r.Status || "";
        const ic = (r.ItemCode || "").replace(/"/g, '""');
        const bc = (r.Barcode || "").replace(/"/g, '""');
        const nm = (r.Item_Name || "").replace(/"/g, '""');
        const uom = (r.UOM || "PCS").replace(/"/g, '""');
        return `"${s}","${ic}","${bc}","${nm}","${uom}"`;
      })
      .join("\n");

    const filename = `merge-${status}-${req.params.mergeId.slice(0, 8)}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(header + body);
  },
);

module.exports = router;
