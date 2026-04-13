const jwt = require("jsonwebtoken");

const JWT_SECRET =
  process.env.JWT_SECRET || "warehouse_inv_super_secret_key_2026";

/**
 * Verifies Bearer token and attaches req.user = { userId, username, role }
 * Returns 401 if missing/invalid, 403 if expired.
 */
const requireAuth = (req, res, next) => {
  let token = null;
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (req.query && req.query.token) {
    // Allow token via query param for file downloads (e.g. CSV export)
    token = req.query.token;
  }
  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: "Authentication required." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(403)
        .json({
          success: false,
          error: "Session expired. Please log in again.",
        });
    }
    return res.status(401).json({ success: false, error: "Invalid token." });
  }
};

/**
 * Must come after requireAuth.
 * Returns 403 if the logged-in user is not an admin or superadmin.
 */
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required." });
  }
  next();
};

/**
 * Must come after requireAuth.
 * Returns 403 if the logged-in user is not a superadmin.
 */
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "superadmin") {
    return res
      .status(403)
      .json({ success: false, error: "Super Admin access required." });
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireSuperAdmin };
