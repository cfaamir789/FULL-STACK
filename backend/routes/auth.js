const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const JWT_SECRET = process.env.JWT_SECRET || 'warehouse_inv_super_secret_key_2026';
const TOKEN_EXPIRY = '30d'; // workers stay logged in for 30 days

// ─── POST /api/auth/setup ───────────────────────────────────────────────────
// Creates the first admin account. Blocked once any user exists.
router.post('/setup', async (req, res) => {
  try {
    const existing = await db.users.findAsync({});
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: 'Setup already complete. Use /login.' });
    }
    const { username, pin } = req.body;
    if (!username || !pin) {
      return res.status(400).json({ success: false, error: 'username and pin are required.' });
    }
    if (String(pin).length < 4) {
      return res.status(400).json({ success: false, error: 'PIN must be at least 4 digits.' });
    }
    const hash = await bcrypt.hash(String(pin), 10);
    const user = await db.users.insertAsync({
      username: username.trim().toUpperCase(),
      pin_hash: hash,
      role: 'admin',
      createdAt: new Date(),
    });
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );
    res.status(201).json({ success: true, token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, pin } = req.body;
    if (!username || !pin) {
      return res.status(400).json({ success: false, error: 'username and pin are required.' });
    }
    const user = await db.users.findOneAsync({ username: username.trim().toUpperCase() });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or PIN.' });
    }
    const match = await bcrypt.compare(String(pin), user.pin_hash);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid username or PIN.' });
    }
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );
    res.json({ success: true, token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Admin-only: create a new worker account
router.post('/register', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, pin, role = 'worker' } = req.body;
    if (!username || !pin) {
      return res.status(400).json({ success: false, error: 'username and pin are required.' });
    }
    if (String(pin).length < 4) {
      return res.status(400).json({ success: false, error: 'PIN must be at least 4 digits.' });
    }
    if (!['admin', 'worker'].includes(role)) {
      return res.status(400).json({ success: false, error: 'role must be admin or worker.' });
    }
    const hash = await bcrypt.hash(String(pin), 10);
    const user = await db.users.insertAsync({
      username: username.trim().toUpperCase(),
      pin_hash: hash,
      role,
      createdAt: new Date(),
    });
    res.status(201).json({ success: true, username: user.username, role: user.role });
  } catch (err) {
    if (err.errorType === 'uniqueViolated') {
      return res.status(409).json({ success: false, error: 'Username already exists.' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/auth/users ─────────────────────────────────────────────────────
// Admin-only: list all users (no hashes returned)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.users.findAsync({});
    const safe = users.map((u) => ({ id: u._id, username: u.username, role: u.role, createdAt: u.createdAt }));
    res.json({ success: true, users: safe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /api/auth/users/:username ────────────────────────────────────────
// Admin-only: delete a worker account
router.delete('/users/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = req.params.username.toUpperCase();
    if (username === req.user.username) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account.' });
    }
    const removed = await db.users.removeAsync({ username }, {});
    if (removed === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/auth/check-setup ──────────────────────────────────────────────
// Frontend calls this to decide whether to show the Setup screen or Login screen
router.get('/check-setup', async (req, res) => {
  try {
    const count = await db.users.countAsync({});
    res.json({ success: true, needsSetup: count === 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
