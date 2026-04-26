require("dotenv").config();
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const path = require("path");
const itemsRouter = require("./routes/items");
const syncRouter = require("./routes/sync");
const authRouter = require("./routes/auth");
const binContentRouter = require("./routes/binContent");
const binMasterRouter = require("./routes/binMaster");
const templateRouter = require("./routes/template");
const reportsRouter = require("./routes/reports");
const connectDB = require("./config/database");

const compression = require("compression");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const setHtmlCacheHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "private, no-cache, max-age=0, must-revalidate",
  );
};

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

// Track connected admin clients
const adminClients = new Set();

wss.on("connection", (ws) => {
  adminClients.add(ws);
  ws.isAlive = true;
  console.log(`WS client connected (${adminClients.size} total)`);

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("close", () => {
    adminClients.delete(ws);
    console.log(`WS client disconnected (${adminClients.size} total)`);
  });

  ws.on("error", () => {
    adminClients.delete(ws);
  });
});

// Ping all clients every 30s to keep connections alive through Render's proxy
const wsPingInterval = setInterval(() => {
  for (const ws of adminClients) {
    if (!ws.isAlive) {
      ws.terminate();
      adminClients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

// Broadcast a message to all connected admin dashboards
function broadcast(eventType, data = {}) {
  const msg = JSON.stringify({ type: eventType, ...data, ts: Date.now() });
  for (const ws of adminClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

// Expose broadcast so routes can use it
app.set("broadcast", broadcast);

// Middleware
// Skip compression for routes that send a pre-gzipped buffer (res.locals.noCompress)
app.use(
  compression({
    filter: (req, res) => {
      if (res.locals.noCompress) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Serve admin web panel — cached for 1 hour
app.use(
  "/admin",
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        setHtmlCacheHeaders(res);
      }
    },
  }),
);
app.get("/admin", (req, res) => {
  setHtmlCacheHeaders(res);
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
// Sub-page catch-all — serves admin.html for /admin/bin-content/, /admin/item-master/ etc.
// so that reloading a sub-page URL stays on the correct page instead of 404-ing
app.get("/admin/*path", (req, res) => {
  setHtmlCacheHeaders(res);
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
// Super Admin Console — separate page at /superadmin
app.get("/superadmin", (req, res) => {
  setHtmlCacheHeaders(res);
  res.sendFile(path.join(__dirname, "public", "superadmin.html"));
});
// Root URL → redirect to admin panel
app.get("/", (req, res) => {
  res.redirect("/admin");
});

// Health check — phone pings this to detect if backend is reachable
app.get("/api/health", (req, res) => {
  const mongoose = require("mongoose");
  const now = new Date();
  res.json({
    status: "ok",
    timestamp: now.toISOString(),
    serverTime: now.getTime(),
    timezone: "Asia/Kolkata",
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "local",
    node: process.version,
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    dbState: mongoose.connection.readyState,
  });
});

// DB status — fast check for admin panel
app.get("/api/db-status", (req, res) => {
  const mongoose = require("mongoose");
  const state = mongoose.connection.readyState;
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  res.json({
    connected: state === 1,
    state,
    stateLabel:
      ["disconnected", "connected", "connecting", "disconnecting"][state] ||
      "unknown",
  });
});

// Routes
app.use("/api/auth", authRouter);
app.use("/api/items", itemsRouter);
app.use("/api/bin-content", binContentRouter);
app.use("/api/bin-master", binMasterRouter);
app.use("/api/template", templateRouter);
app.use("/api/transactions", syncRouter);
app.use("/api/sync", syncRouter);
app.use("/api/reports", reportsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// Connect to MongoDB, but start listening regardless
// Start listening IMMEDIATELY so Render sees the port open
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin`);
  console.log(`WebSocket:    ws://localhost:${PORT}/ws`);

  // Keep-alive self-ping every 4 min to prevent Render/Railway free tier sleep
  if (process.env.NODE_ENV === "production") {
    const selfUrl = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/health`
      : process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/health`
        : `https://fullstck-production.up.railway.app/api/health`;

    // Also ping the other deployment to keep it warm
    const otherUrl = selfUrl.includes("railway")
      ? `https://fullstck.onrender.com/api/health`
      : `https://fullstck-production.up.railway.app/api/health`;

    const ping = (url) => {
      require("https")
        .get(url, () => {})
        .on("error", () => {});
    };
    // First ping after 30s, then every 4 minutes
    setTimeout(() => {
      ping(selfUrl);
      ping(otherUrl);
    }, 30 * 1000);
    setInterval(
      () => {
        ping(selfUrl);
        ping(otherUrl);
      },
      4 * 60 * 1000,
    );
    console.log("Keep-alive ping enabled (every 4 min) for self + partner");
  }
});

// Connect to MongoDB in the background (don't block server start)
connectDB()
  .then(async () => {
    // ─── One-time startup migration ─────────────────────────────────────────
    try {
      const crypto = require("crypto");
      const User = require("./models/User");
      const Transaction = require("./models/Transaction");
      const WorkerSync = require("./models/WorkerSync");
      const Meta = require("./models/Meta");

      // Migration v2: set AAMIR as superadmin with fixed recovery keys
      let migrationV2 = await Meta.findOne({
        key: "superadmin_migration_v2",
      }).catch(() => null);
      if (!migrationV2) {
        console.log("Running migration v2: set superadmin recovery keys...");

        const aamir = await User.findOne({ username: "AAMIR" });
        if (aamir) {
          aamir.role = "superadmin";
          aamir.recoveryKeys = ["81225067", "97333802"];
          // Remove old field if present
          aamir.recoveryKey = undefined;
          await aamir.save();
          console.log("AAMIR set as SUPER ADMIN with permanent recovery keys.");
        } else {
          console.log("User AAMIR not found — will need manual setup.");
        }

        // Clean old test data (safe to re-run — only deletes if data exists)
        const txDel = await Transaction.deleteMany({});
        if (txDel.deletedCount > 0)
          console.log("Cleaned " + txDel.deletedCount + " old transactions.");
        const wsDel = await WorkerSync.deleteMany({});
        if (wsDel.deletedCount > 0)
          console.log(
            "Cleaned " + wsDel.deletedCount + " old worker sync records.",
          );

        await Meta.findOneAndUpdate(
          { key: "superadmin_migration_v2" },
          { key: "superadmin_migration_v2", version: 1 },
          { upsert: true },
        );
        console.log("Migration v2 complete!");
      }
    } catch (migErr) {
      console.error("Migration error (non-fatal):", migErr.message);
    }

    // Warm the bulk-download cache on startup so the first phone request is instant
    try {
      const { _warmBulkCache } = require("./routes/items");
      await _warmBulkCache();
      console.log("[items-cache] warm-up complete");
    } catch (e) {
      console.warn("[items-cache] warm-up failed (non-fatal):", e.message);
    }

    // Warm bin-content meta cache (categories + zones + stats) on startup
    try {
      const { _warmBinMetaCache } = require("./routes/binContent");
      await _warmBinMetaCache();
      console.log("[bin-meta-cache] warm-up complete");
    } catch (e) {
      console.warn("[bin-meta-cache] warm-up failed (non-fatal):", e.message);
    }
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err?.message);
  });
