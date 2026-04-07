const express = require("express");
const router = express.Router();
const multer = require("multer");
const Papa = require("papaparse");
const Item = require("../models/Item");
const Meta = require("../models/Meta");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

// ─── Item Version Tracking ──────────────────────────────────────────────────
let _itemsVersion = 0;

// Load persisted version on startup
(async () => {
  try {
    const doc = await Meta.findOne({ key: "itemsVersion" });
    if (doc) _itemsVersion = doc.version;
  } catch (_) {}
})();

async function bumpItemsVersion() {
  _itemsVersion++;
  await Meta.findOneAndUpdate(
    { key: "itemsVersion" },
    { $set: { version: _itemsVersion } },
    { upsert: true, new: true }
  );
  return _itemsVersion;
}

// GET /api/items/version — lightweight check for phones (no auth needed)
router.get("/version", async (req, res) => {
  res.json({ success: true, version: _itemsVersion });
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
    let query = {};
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query = {
        $or: [{ Item_Name: regex }, { Barcode: regex }, { ItemCode: regex }],
      };
    }
    
    const items = await Item.find(query)
      .sort({ Item_Name: 1 })
      ;
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
      return res
        .status(400)
        .json({
          success: false,
          error: "ItemCode, Barcode, and Item_Name are required",
        });
    }
    const item = await Item.findOneAndUpdate(
      { Barcode },
      { $set: { ItemCode, Barcode, Item_Name } },
      { upsert: true, new: true }
    );
    await bumpItemsVersion();
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
          { $set: { ItemCode: item.ItemCode, Barcode: item.Barcode, Item_Name: item.Item_Name } },
          { upsert: true }
        );
        if (result.upsertedId) inserted++;
        else modified++;
      }),
    );
    await bumpItemsVersion();
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
    await bumpItemsVersion();
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
    await bumpItemsVersion();
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
router.post("/upload-csv", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }
    const csvText = req.file.buffer.toString("utf8");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return res
        .status(400)
        .json({
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

    const items = parsed.data
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

    if (items.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No valid rows found in CSV" });
    }

    const mode = req.query.mode || "replace"; // 'replace' or 'merge'

    if (mode === "replace") {
      await Item.deleteMany({});
    }

    let inserted = 0,
      modified = 0;
    for (const item of items) {
      const result = await Item.updateOne(
        { Barcode: item.Barcode },
        { $set: { ItemCode: item.ItemCode, Barcode: item.Barcode, Item_Name: item.Item_Name } },
        { upsert: true }
      );
      if (result.upsertedId) inserted++;
      else modified++;
    }

    const totalItems = await Item.countDocuments({});
    await bumpItemsVersion();
    res.json({ success: true, inserted, modified, totalItems });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
