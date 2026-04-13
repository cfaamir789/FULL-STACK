const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const Papa = require("papaparse");
const { randomUUID } = require("crypto");
const Item = require("../models/Item");
const Meta = require("../models/Meta");
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

// Apply requireDB to all routes in this router
router.use(requireDB);

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

const uploadJobs = new Map();

function setUploadJob(jobId, patch) {
  const prev = uploadJobs.get(jobId) || {};
  uploadJobs.set(jobId, { ...prev, ...patch, updatedAt: Date.now() });
}

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

  const rawItems = parsed.data
    .filter((r) =>
      hasOldFormat
        ? r["Barcode No."] && r["Item Description"]
        : r.Barcode && r.Item_Name,
    )
    .map((r) => ({
      ItemCode: hasOldFormat
        ? r["Item No."] || r["Barcode No."]
        : r.ItemCode || r.Barcode,
      Barcode: String(hasOldFormat ? r["Barcode No."] : r.Barcode).trim(),
      Item_Name: String(
        hasOldFormat ? r["Item Description"] : r.Item_Name,
      ).trim(),
    }));

  const dedup = new Map();
  for (const item of rawItems) {
    dedup.set(item.Barcode, item);
  }
  const items = Array.from(dedup.values());

  if (items.length === 0) {
    throw new Error("No valid rows found in CSV");
  }
  return items;
}

async function applyCsvItems(items, mode, onProgress, req) {
  if (mode === "replace") {
    await Item.deleteMany({});
  }

  let inserted = 0;
  let modified = 0;
  let processed = 0;
  const total = items.length;

  if (mode === "replace") {
    const chunks = chunkArray(items, 3000);
    for (const chunk of chunks) {
      try {
        const result = await Item.insertMany(chunk, { ordered: false });
        inserted += result.length;
      } catch (err) {
        // BulkWriteError — some inserted, some skipped as duplicates
        if (err.insertedDocs !== undefined) {
          inserted += err.insertedDocs.length || 0;
        } else if (err.result?.nInserted !== undefined) {
          inserted += err.result.nInserted;
        } else {
          inserted += chunk.length - (err.writeErrors?.length || 0);
        }
      }
      processed += chunk.length;
      onProgress?.({ processed, total, inserted, modified });
    }
  } else {
    const chunks = chunkArray(items, 1000);
    for (const chunk of chunks) {
      const ops = chunk.map((item) => ({
        updateOne: {
          filter: { Barcode: item.Barcode },
          update: {
            $set: {
              ItemCode: item.ItemCode,
              Barcode: item.Barcode,
              Item_Name: item.Item_Name,
            },
          },
          upsert: true,
        },
      }));
      const result = await Item.bulkWrite(ops, { ordered: false });
      inserted += result.upsertedCount || 0;
      modified += result.modifiedCount || 0;
      processed += chunk.length;
      onProgress?.({ processed, total, inserted, modified });
    }
  }

  await bumpItemsVersion(req);
  const totalItems = await Item.countDocuments({});
  return { inserted, modified, totalItems, processed, total };
}

// ─── Item Version Tracking ──────────────────────────────────────────────────
// Always read from MongoDB so multiple server instances stay in sync.

async function getItemsVersion() {
  const doc = await Meta.findOne({ key: "itemsVersion" }).lean();
  return doc ? doc.version : 0;
}

async function bumpItemsVersion(req) {
  const doc = await Meta.findOneAndUpdate(
    { key: "itemsVersion" },
    { $inc: { version: 1 } },
    { upsert: true, new: true },
  );
  // Broadcast to all connected admin dashboards
  const broadcast = req?.app?.get("broadcast");
  if (broadcast) {
    const count = await Item.countDocuments({});
    broadcast("items_updated", { version: doc.version, totalItems: count });
  }
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

// GET /api/items/bulk — download ALL items in a single compressed JSON response
// Used by phones for atomic item master download (replaces paginated pull)
router.get("/bulk", async (req, res) => {
  try {
    const items = await Item.find(
      {},
      { _id: 0, ItemCode: 1, Barcode: 1, Item_Name: 1 },
    )
      .sort({ Item_Name: 1 })
      .lean();
    const version = await getItemsVersion();
    res.json({
      success: true,
      version,
      total: items.length,
      items,
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
      return res
        .status(400)
        .json({
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
        Item.find(query).sort({ Item_Name: 1 }).skip(skip).limit(limit).lean(),
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

    const items = await Item.find(query).sort({ Item_Name: 1 }).lean();
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
      { $set: { ItemCode, Barcode, Item_Name } },
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
    await Promise.all(
      items.map(async (item) => {
        const result = await Item.updateOne(
          { Barcode: item.Barcode },
          {
            $set: {
              ItemCode: item.ItemCode,
              Barcode: item.Barcode,
              Item_Name: item.Item_Name,
            },
          },
          { upsert: true },
        );
        if (result.upsertedId) inserted++;
        else modified++;
      }),
    );
    await bumpItemsVersion(req);
    res.json({ success: true, inserted, modified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/items/all — admin: clear all items before re-import
router.delete("/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await Item.countDocuments({});
    await Item.deleteMany({});
    await bumpItemsVersion(req);
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
    // Clear old items
    await Item.deleteMany({});
    // Insert new
    let inserted = 0;
    await Promise.all(
      items.map(async (item) => {
        await Item.create({
          ItemCode: item.ItemCode,
          Barcode: item.Barcode,
          Item_Name: item.Item_Name,
        });
        inserted++;
      }),
    );
    await bumpItemsVersion(req);
    res.json({ success: true, inserted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/upload-csv — admin web panel: upload a CSV file
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
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
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        return res.status(400).json({
          success: false,
          error: "CSV parsing failed: " + parsed.errors[0].message,
        });
      }

      const firstRow = parsed.data[0];
      if (!firstRow) {
        return res.status(400).json({ success: false, error: "CSV is empty" });
      }

      const hasNewFormat = "Barcode" in firstRow && "Item_Name" in firstRow;
      const hasOldFormat =
        "Barcode No." in firstRow && "Item Description" in firstRow;

      if (!hasNewFormat && !hasOldFormat) {
        return res.status(400).json({
          success: false,
          error:
            "CSV must have headers: ItemCode, Barcode, Item_Name (or Item No., Barcode No., Item Description)",
          foundHeaders: Object.keys(firstRow),
        });
      }

      const rawItems = parsed.data
        .filter((r) =>
          hasOldFormat
            ? r["Barcode No."] && r["Item Description"]
            : r.Barcode && r.Item_Name,
        )
        .map((r) => ({
          ItemCode: hasOldFormat
            ? r["Item No."] || r["Barcode No."]
            : r.ItemCode || r.Barcode,
          Barcode: String(hasOldFormat ? r["Barcode No."] : r.Barcode).trim(),
          Item_Name: String(
            hasOldFormat ? r["Item Description"] : r.Item_Name,
          ).trim(),
        }));

      // Keep only the latest row per barcode to avoid duplicate writes.
      const dedup = new Map();
      for (const item of rawItems) {
        dedup.set(item.Barcode, item);
      }
      const items = Array.from(dedup.values());

      if (items.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "No valid rows found in CSV" });
      }

      const mode = req.query.mode || "replace"; // 'replace' or 'merge'

      if (mode === "replace") {
        await Item.deleteMany({});
      }

      let inserted = 0;
      let modified = 0;

      if (mode === "replace") {
        const chunks = chunkArray(items, 2000);
        for (const chunk of chunks) {
          await Item.insertMany(chunk, { ordered: false });
        }
        inserted = items.length;
      } else {
        const chunks = chunkArray(items, 1000);
        for (const chunk of chunks) {
          const ops = chunk.map((item) => ({
            updateOne: {
              filter: { Barcode: item.Barcode },
              update: {
                $set: {
                  ItemCode: item.ItemCode,
                  Barcode: item.Barcode,
                  Item_Name: item.Item_Name,
                },
              },
              upsert: true,
            },
          }));
          const result = await Item.bulkWrite(ops, { ordered: false });
          inserted += result.upsertedCount || 0;
          modified += result.modifiedCount || 0;
        }
      }

      const totalItems = await Item.countDocuments({});
      await bumpItemsVersion(req);
      res.json({ success: true, inserted, modified, totalItems });
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

      setUploadJob(jobId, {
        status: "queued",
        mode,
        processed: 0,
        total: 0,
        inserted: 0,
        modified: 0,
        error: null,
        totalItems: 0,
      });

      setImmediate(async () => {
        try {
          const items = parseCsvItems(csvText);
          setUploadJob(jobId, {
            status: "processing",
            total: items.length,
            processed: 0,
          });

          const result = await applyCsvItems(items, mode, (progress) => {
            setUploadJob(jobId, {
              status: "processing",
              ...progress,
            });
          }, req);

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

module.exports = router;
