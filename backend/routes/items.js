const express = require('express');
const router = express.Router();
const Item = require('../models/Item');

// GET /api/items — return all items
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let query = {};
    if (q) {
      query = {
        $or: [
          { Item_Name: { $regex: q, $options: 'i' } },
          { Barcode: { $regex: q, $options: 'i' } },
          { ItemCode: { $regex: q, $options: 'i' } },
        ],
      };
    }
    const items = await Item.find(query).sort({ Item_Name: 1 }).lean();
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
    const item = await Item.findOneAndUpdate(
      { Barcode },
      { ItemCode, Barcode, Item_Name },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/items/import — bulk upsert array of items
router.post('/import', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required' });
    }
    const ops = items.map((item) => ({
      updateOne: {
        filter: { Barcode: item.Barcode },
        update: { $set: { ItemCode: item.ItemCode, Barcode: item.Barcode, Item_Name: item.Item_Name } },
        upsert: true,
      },
    }));
    const result = await Item.bulkWrite(ops);
    res.json({
      success: true,
      inserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
