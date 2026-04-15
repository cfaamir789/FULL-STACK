const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/authMiddleware");

// Helper: fire-and-forget audit log (never blocks the request)
function audit(
  actor,
  actorRole,
  action,
  target,
  detail,
  source = "admin_panel",
) {
  AuditLog.create({
    actor,
    actorRole,
    action,
    target: target || "",
    detail: detail || "",
    source,
  }).catch(() => {});
}

const JWT_SECRET =
  process.env.JWT_SECRET || "warehouse_inv_super_secret_key_2026";
const TOKEN_EXPIRY = "30d"; // workers stay logged in for 30 days

// Middleware: fail fast if MongoDB is not connected
function requireDB(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error: "Database is not connected. Please try again shortly.",
      dbState: mongoose.connection.readyState,
    });
  }
  next();
}

// ─── POST /api/auth/setup ───────────────────────────────────────────────────
// Creates the first admin account. Blocked once any user exists.
router.post("/setup", requireDB, async (req, res) => {
  try {
    const existing = await User.find({});
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ success: false, error: "Setup already complete. Use /login." });
    }
    const { username, pin } = req.body;
    if (!username || !pin) {
      return res
        .status(400)
        .json({ success: false, error: "username and pin are required." });
    }
    if (String(pin).length < 4) {
      return res
        .status(400)
        .json({ success: false, error: "PIN must be at least 4 digits." });
    }
    const hash = await bcrypt.hash(String(pin), 10);
    // First user created via setup is always superadmin
    const user = await User.create({
      username: username.trim().toUpperCase(),
      pin_hash: hash,
      role: "superadmin",
      recoveryKeys: [],
      createdAt: new Date(),
    });
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY },
    );
    res.status(201).json({
      success: true,
      token,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────────────────────
router.post("/login", requireDB, async (req, res) => {
  try {
    const { username, pin } = req.body;
    if (!username || !pin) {
      return res
        .status(400)
        .json({ success: false, error: "username and pin are required." });
    }
    const user = await User.findOne({
      username: username.trim().toUpperCase(),
    });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid username or PIN." });
    }
    if (user.isBlocked) {
      return res
        .status(403)
        .json({ success: false, error: "Your account has been blocked. Please contact your administrator." });
    }
    const match = await bcrypt.compare(String(pin), user.pin_hash);
    if (!match) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid username or PIN." });
    }
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY },
    );
    res.json({
      success: true,
      token,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/auth/recover-superadmin ──────────────────────────────────────
// Super Admin forgot PIN — use recovery key to set a new PIN
router.post("/recover-superadmin", requireDB, async (req, res) => {
  try {
    const { username, recoveryKey, newPin } = req.body;
    if (!username || !recoveryKey || !newPin) {
      return res.status(400).json({
        success: false,
        error: "username, recoveryKey, and newPin are required.",
      });
    }
    if (String(newPin).length < 4) {
      return res
        .status(400)
        .json({ success: false, error: "PIN must be at least 4 digits." });
    }
    const user = await User.findOne({
      username: username.trim().toUpperCase(),
      role: "superadmin",
    });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "Super Admin not found." });
    }
    const keys = user.recoveryKeys || [];
    if (!keys.length || !keys.includes(recoveryKey.trim())) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid recovery key." });
    }
    // Reset PIN — recovery keys stay the same (permanent)
    const hash = await bcrypt.hash(String(newPin), 10);
    user.pin_hash = hash;
    await user.save();
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY },
    );
    res.json({
      success: true,
      token,
      username: user.username,
      role: user.role,
      message: "PIN reset successful! You are now logged in.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/auth/impersonate/:username ────────────────────────────────────
// Superadmin only — issues a 15-min emergency token for any admin/worker without their PIN
router.post(
  "/impersonate/:username",
  requireDB,
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const targetUsername = req.params.username.toUpperCase();
      const target = await User.findOne({ username: targetUsername });

      if (!target)
        return res.status(404).json({ success: false, error: "User not found." });
      if (target.role === "superadmin")
        return res.status(403).json({ success: false, error: "Cannot impersonate a superadmin account." });

      audit(
        req.user.username,
        req.user.role,
        "impersonate_admin",
        targetUsername,
        `Superadmin ${req.user.username} opened emergency session as ${targetUsername}`,
        "superadmin_panel",
      );

      // Short-lived token — expires in 15 minutes
      const token = jwt.sign(
        {
          userId: target._id,
          username: target.username,
          role: target.role,
          impersonatedBy: req.user.username,
        },
        JWT_SECRET,
        { expiresIn: "15m" },
      );

      res.json({ success: true, token, expiresIn: 900, targetUsername });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Admin-only: create a new worker/admin account (only superadmin can create admins)
router.post(
  "/register",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { username, pin, role = "worker" } = req.body;
      if (!username || !pin) {
        return res
          .status(400)
          .json({ success: false, error: "username and pin are required." });
      }
      if (String(pin).length < 4) {
        return res
          .status(400)
          .json({ success: false, error: "PIN must be at least 4 digits." });
      }
      // Only superadmin can create admin accounts
      if (role === "admin" && req.user.role !== "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Only Super Admin can create admin accounts.",
        });
      }
      // Nobody can create another superadmin
      if (role === "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Cannot create another Super Admin.",
        });
      }
      if (!["admin", "worker"].includes(role)) {
        return res
          .status(400)
          .json({ success: false, error: "role must be admin or worker." });
      }
      const { employeeId = "", deviceModel = "" } = req.body;
      const hash = await bcrypt.hash(String(pin), 10);
      const user = await User.create({
        username: username.trim().toUpperCase(),
        pin_hash: hash,
        role,
        employeeId: String(employeeId).trim(),
        deviceModel: String(deviceModel).trim(),
        createdAt: new Date(),
      });
      audit(
        req.user.username,
        req.user.role,
        "create_user",
        user.username,
        `Role: ${role}, EmpID: ${employeeId}, Device: ${deviceModel}`,
      );
      res
        .status(201)
        .json({ success: true, username: user.username, role: user.role });
    } catch (err) {
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ success: false, error: "Username already exists." });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── GET /api/auth/users ─────────────────────────────────────────────────────
// Admin-only: list all users (no hashes returned)
router.get("/me", requireDB, requireAuth, async (req, res) => {
  res.json({
    success: true,
    user: {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role,
    },
  });
});

router.get("/users", requireDB, requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({});
    const safe = users.map((u) => ({
      id: u._id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      employeeId: u.employeeId || "",
      deviceModel: u.deviceModel || "",
      isBlocked: !!u.isBlocked,
    }));
    res.json({ success: true, users: safe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /api/auth/users/:username ────────────────────────────────────────
// Delete a user account (superadmin protected)
router.delete(
  "/users/:username",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = req.params.username.toUpperCase();
      // Cannot delete yourself
      if (username === req.user.username) {
        return res
          .status(400)
          .json({ success: false, error: "Cannot delete your own account." });
      }
      // Check if target is superadmin — nobody can delete superadmin
      const target = await User.findOne({ username });
      if (!target) {
        return res
          .status(404)
          .json({ success: false, error: "User not found." });
      }
      if (target.role === "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Super Admin account cannot be deleted.",
        });
      }
      // Only superadmin can delete admin accounts
      if (target.role === "admin" && req.user.role !== "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Only Super Admin can delete admin accounts.",
        });
      }
      await User.deleteOne({ username });
      audit(
        req.user.username,
        req.user.role,
        "delete_user",
        username,
        `Deleted role: ${target.role}`,
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── POST /api/auth/users/:username/reset-pin ───────────────────────────────
// Reset a user's PIN (superadmin protected)
router.post(
  "/users/:username/reset-pin",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = req.params.username.toUpperCase();
      const { pin } = req.body;
      if (!pin || String(pin).length < 4) {
        return res
          .status(400)
          .json({ success: false, error: "PIN must be at least 4 digits." });
      }
      const user = await User.findOne({ username });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "User not found." });
      }
      // Only superadmin can reset their own PIN or another superadmin's PIN
      if (user.role === "superadmin" && req.user.role !== "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Only Super Admin can reset Super Admin's PIN.",
        });
      }
      // Regular admins cannot reset other admin PINs
      if (
        user.role === "admin" &&
        req.user.role !== "superadmin" &&
        username !== req.user.username
      ) {
        return res.status(403).json({
          success: false,
          error: "Only Super Admin can reset other admins' PINs.",
        });
      }
      const hash = await bcrypt.hash(String(pin), 10);
      user.pin_hash = hash;
      await user.save();
      audit(
        req.user.username,
        req.user.role,
        "reset_pin",
        username,
        `Reset PIN for ${username}`,
      );
      res.json({ success: true, username: user.username });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── PUT /api/auth/users/:username/worker-info ──────────────────────────────
// Save employeeId and deviceModel for a worker (admin only)
router.put(
  "/users/:username/worker-info",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = req.params.username.toUpperCase();
      const { employeeId, deviceModel } = req.body;
      const user = await User.findOne({ username });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "User not found." });
      }
      if (user.role !== "worker") {
        return res
          .status(400)
          .json({
            success: false,
            error: "Only worker accounts support this field.",
          });
      }
      if (employeeId !== undefined) user.employeeId = String(employeeId).trim();
      if (deviceModel !== undefined)
        user.deviceModel = String(deviceModel).trim();
      await user.save();
      res.json({
        success: true,
        employeeId: user.employeeId,
        deviceModel: user.deviceModel,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── PUT /api/auth/users/:username/block ────────────────────────────────────
// Block or unblock a user account (admin only, superadmin protected)
router.put(
  "/users/:username/block",
  requireDB,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = req.params.username.toUpperCase();
      const { blocked } = req.body; // true = block, false = unblock
      if (typeof blocked !== "boolean") {
        return res
          .status(400)
          .json({ success: false, error: "blocked must be true or false." });
      }
      const user = await User.findOne({ username });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "User not found." });
      }
      // Cannot block superadmin
      if (user.role === "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Super Admin account cannot be blocked.",
        });
      }
      // Only superadmin can block/unblock admin accounts
      if (user.role === "admin" && req.user.role !== "superadmin") {
        return res.status(403).json({
          success: false,
          error: "Only Super Admin can block/unblock admin accounts.",
        });
      }
      // Cannot block yourself
      if (username === req.user.username) {
        return res
          .status(400)
          .json({ success: false, error: "Cannot block your own account." });
      }
      user.isBlocked = blocked;
      await user.save();
      audit(
        req.user.username,
        req.user.role,
        blocked ? "block_user" : "unblock_user",
        username,
        `${blocked ? "Blocked" : "Unblocked"} user ${username}`,
      );
      res.json({ success: true, username: user.username, isBlocked: user.isBlocked });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── GET /api/auth/audit-logs ─────────────────────────────────────────────────────────
// Superadmin only: fetch audit logs
router.get(
  "/audit-logs",
  requireDB,
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
      const skip = parseInt(req.query.skip) || 0;
      const actor = req.query.actor || "";
      const action = req.query.action || "";
      const filter = {};
      if (actor) filter.actor = actor.toUpperCase();
      if (action) filter.action = action;
      const [logs, total] = await Promise.all([
        AuditLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(filter),
      ]);
      res.json({ success: true, logs, total });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);
// ─── GET /api/auth/check-setup ──────────────────────────────────────────────
// Frontend calls this to decide whether to show the Setup screen or Login screen
router.get("/check-setup", requireDB, async (req, res) => {
  try {
    const count = await User.countDocuments({});
    res.json({ success: true, needsSetup: count === 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
