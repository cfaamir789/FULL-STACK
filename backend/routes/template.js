const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const CategoryMaster = require("../models/CategoryMaster");
const StoreMaster = require("../models/StoreMaster");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

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

// ─── Categories ───────────────────────────────────────────────────────────────

// GET /api/template/categories
router.get("/categories", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const cats = await CategoryMaster.find().sort({ categoryCode: 1 }).lean();
    res.json({ success: true, data: cats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/template/categories/import  (bulk upsert — registered BEFORE /:id)
router.post("/categories/import", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: "Array of categories required." });
    }
    let upserted = 0;
    for (const row of rows) {
      if (!row.categoryCode) continue;
      await CategoryMaster.findOneAndUpdate(
        { categoryCode: row.categoryCode.trim() },
        {
          $set: {
            categoryName: row.categoryName ?? "",
            buyer: row.buyer ?? "",
            picker: row.picker ?? "",
            storeCode: row.storeCode ?? "",
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      upserted++;
    }
    res.json({ success: true, upserted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/template/categories
router.post("/categories", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { categoryCode, categoryName, buyer, picker, storeCode } = req.body;
    if (!categoryCode) {
      return res.status(400).json({ success: false, error: "categoryCode is required." });
    }
    const cat = await CategoryMaster.create({
      categoryCode: categoryCode.trim(),
      categoryName: categoryName ?? "",
      buyer: buyer ?? "",
      picker: picker ?? "",
      storeCode: storeCode ?? "",
    });
    res.json({ success: true, data: cat });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: "Category code already exists." });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/template/categories/:id
router.put("/categories/:id", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { categoryCode, categoryName, buyer, picker, storeCode } = req.body;
    const cat = await CategoryMaster.findByIdAndUpdate(
      req.params.id,
      { $set: { categoryCode, categoryName, buyer, picker, storeCode, updatedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!cat) return res.status(404).json({ success: false, error: "Category not found." });
    res.json({ success: true, data: cat });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: "Category code already exists." });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/template/categories/:id
router.delete("/categories/:id", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const cat = await CategoryMaster.findByIdAndDelete(req.params.id);
    if (!cat) return res.status(404).json({ success: false, error: "Category not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Stores ───────────────────────────────────────────────────────────────────

// GET /api/template/stores
router.get("/stores", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const stores = await StoreMaster.find().sort({ storeCode: 1 }).lean();
    res.json({ success: true, data: stores });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/template/stores
router.post("/stores", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { storeCode, storeName } = req.body;
    if (!storeCode) {
      return res.status(400).json({ success: false, error: "storeCode is required." });
    }
    const store = await StoreMaster.create({
      storeCode: storeCode.trim(),
      storeName: storeName ?? "",
    });
    res.json({ success: true, data: store });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: "Store code already exists." });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/template/stores/:id
router.put("/stores/:id", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { storeCode, storeName } = req.body;
    const store = await StoreMaster.findByIdAndUpdate(
      req.params.id,
      { $set: { storeCode, storeName, updatedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!store) return res.status(404).json({ success: false, error: "Store not found." });
    res.json({ success: true, data: store });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: "Store code already exists." });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/template/stores/:id
router.delete("/stores/:id", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const store = await StoreMaster.findByIdAndDelete(req.params.id);
    if (!store) return res.status(404).json({ success: false, error: "Store not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
