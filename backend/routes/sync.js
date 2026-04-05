const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const { appendTransactions } = require('../services/googleSheets');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

// POST /api/sync — receive array of offline transactions (requires login)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ success: false, error: 'transactions array is required' });
    }
    for (const tx of transactions) {
      if (!tx.Item_Barcode || !tx.Item_Name || !tx.Frombin || !tx.Tobin || !tx.Qty || !tx.Timestamp) {
        return res.status(400).json({
          success: false,
          error: 'Each transaction must have Item_Barcode, Item_Name, Frombin, Tobin, Qty, Timestamp',
        });
      }
    }
    // worker_name comes from the verified JWT — client cannot spoof it
    const workerName = req.user.username;
    const docs = transactions.map((tx) => ({
      Item_Barcode: tx.Item_Barcode,
      Item_Code: tx.Item_Code || '',
      Item_Name: tx.Item_Name,
      Frombin: tx.Frombin,
      Tobin: tx.Tobin,
      Qty: Number(tx.Qty),
      Timestamp: new Date(tx.Timestamp),
      deviceId: tx.deviceId || 'unknown',
      Worker_Name: workerName,
      createdAt: new Date(),
    }));
    await Transaction.insertAsync(docs);
    // Append to Google Sheet asynchronously — never blocks the phone response
    appendTransactions(docs).catch(() => {});
    res.json({ success: true, synced: docs.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/transactions — return all transactions (newest first, paginated)
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.findAsync({}).sort({ Timestamp: -1 }).skip(skip).limit(limit).execAsync(),
      Transaction.countAsync({}),
    ]);
    res.json({ success: true, total, page, limit, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/transactions/:id — edit (owner or admin only)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const tx = await Transaction.findOneAsync({ _id: req.params.id });
    if (!tx) return res.status(404).json({ success: false, error: 'Transaction not found.' });
    if (req.user.role !== 'admin' && tx.Worker_Name !== req.user.username) {
      return res.status(403).json({ success: false, error: 'You can only edit your own transactions.' });
    }
    const { Frombin, Tobin, Qty } = req.body;
    const updated = await Transaction.updateAsync(
      { _id: req.params.id },
      { $set: { Frombin, Tobin, Qty: Number(Qty) } },
      { returnUpdatedDocs: true }
    );
    res.json({ success: true, transaction: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/transactions/:id — delete (owner or admin only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const tx = await Transaction.findOneAsync({ _id: req.params.id });
    if (!tx) return res.status(404).json({ success: false, error: 'Transaction not found.' });
    if (req.user.role !== 'admin' && tx.Worker_Name !== req.user.username) {
      return res.status(403).json({ success: false, error: 'You can only delete your own transactions.' });
    }
    await Transaction.removeAsync({ _id: req.params.id }, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
