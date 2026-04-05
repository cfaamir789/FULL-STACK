const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

// GET /api/items — return all items
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let query = {};
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query = { $or: [{ Item_Name: regex }, { Barcode: regex }, { ItemCode: regex }] };
    }
    const items = await Item.findAsync(query).sort({ Item_Name: 1 }).execAsync();
    res.json({ success: true, count: items.length, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items — add a single item
router.post('/', async (req, res) => {
  try {
    const { ItemCode, Barcode, Item_Name } = req.body;
    if (!ItemCode || !Barcode || !Item_Name) {
      return res.status(400).json({ success: false, error: 'ItemCode, Barcode, and Item_Name are required' });
    }
    const { affectedDocuments } = await Item.updateAsync(
      { Barcode },
      { $set: { ItemCode, Barcode, Item_Name } },
      { upsert: true, returnUpdatedDocs: true }
    );
    res.status(201).json({ success: true, item: affectedDocuments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/import — bulk upsert array of items (admin only)
router.post('/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required' });
    }
    let inserted = 0;
    let modified = 0;
    await Promise.all(
      items.map(async (item) => {
        const { upsert } = await Item.updateAsync(
          { Barcode: item.Barcode },
          { $set: { ItemCode: item.ItemCode, Barcode: item.Barcode, Item_Name: item.Item_Name } },
          { upsert: true }
        );
        if (upsert) inserted++; else modified++;
      })
    );
    res.json({ success: true, inserted, modified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
