const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');

// POST /api/sync — receive array of offline transactions
router.post('/', async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ success: false, error: 'transactions array is required' });
    }

    // Validate required fields
    for (const tx of transactions) {
      if (!tx.Item_Barcode || !tx.Item_Name || !tx.Frombin || !tx.Tobin || !tx.Qty || !tx.Timestamp) {
        return res.status(400).json({
          success: false,
          error: 'Each transaction must have Item_Barcode, Item_Name, Frombin, Tobin, Qty, Timestamp',
        });
      }
    }

    const docs = transactions.map((tx) => ({
      Item_Barcode: tx.Item_Barcode,
      Item_Name: tx.Item_Name,
      Frombin: tx.Frombin,
      Tobin: tx.Tobin,
      Qty: Number(tx.Qty),
      Timestamp: new Date(tx.Timestamp),
      deviceId: tx.deviceId || 'unknown',
    }));

    await Transaction.insertMany(docs, { ordered: false });
    res.json({ success: true, synced: docs.length });
  } catch (err) {
    // insertMany with ordered:false may partially succeed
    if (err.insertedDocs) {
      res.json({ success: true, synced: err.insertedDocs.length });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// GET /api/transactions — return all transactions (newest first, paginated)
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find().sort({ Timestamp: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(),
    ]);
    res.json({ success: true, total, page, limit, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
