require("dotenv").config();
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const path = require("path");
const itemsRouter = require("./routes/items");
const syncRouter = require("./routes/sync");
const authRouter = require("./routes/auth");
const connectDB = require("./config/database");

const compression = require("compression");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

// Track connected admin clients
const adminClients = new Set();

wss.on("connection", (ws) => {
  adminClients.add(ws);
  console.log(`WS client connected (${adminClients.size} total)`);

  ws.on("close", () => {
    adminClients.delete(ws);
    console.log(`WS client disconnected (${adminClients.size} total)`);
  });

  ws.on("error", () => {
    adminClients.delete(ws);
  });
});

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
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve admin web panel — cached for 1 hour
app.use(
  "/admin",
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }),
);
app.get("/admin", (req, res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
// Root URL → redirect to admin panel
app.get("/", (req, res) => {
  res.redirect("/admin");
});

// Health check — phone pings this to detect if backend is reachable
app.get("/api/health", (req, res) => {
  const mongoose = require("mongoose");
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
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
app.use("/api/transactions", syncRouter);
app.use("/api/sync", syncRouter);

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

  // Keep-alive self-ping every 4 min to prevent Render free tier sleep
  if (process.env.NODE_ENV === "production") {
    const keepAliveUrl = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/health`
      : `https://full-stack-4m9b.onrender.com/api/health`;
    const ping = () => {
      require("https")
        .get(keepAliveUrl, () => {})
        .on("error", () => {});
    };
    // First ping after 30s, then every 4 minutes
    setTimeout(ping, 30 * 1000);
    setInterval(ping, 4 * 60 * 1000);
    console.log("Keep-alive ping enabled (every 4 min)");
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

      // Check if migration already ran (stored in Meta collection)
      let migrationDone = await Meta.findOne({ key: "superadmin_migration_v1" }).catch(() => null);
      if (!migrationDone) {
        console.log("Running one-time superadmin migration...");

        // 1. Upgrade AAMIR to superadmin
        const aamir = await User.findOne({ username: "AAMIR" });
        if (aamir) {
          const recoveryKey = crypto.randomBytes(16).toString("hex");
          aamir.role = "superadmin";
          aamir.recoveryKey = recoveryKey;
          await aamir.save();
          console.log("AAMIR upgraded to SUPER ADMIN");
          console.log("RECOVERY KEY: " + recoveryKey);
        } else {
          console.log("User AAMIR not found — will become superadmin on next setup/register.");
        }

        // 2. Clean all old test transactions
        const txDel = await Transaction.deleteMany({});
        console.log("Cleaned " + txDel.deletedCount + " old transactions.");

        // 3. Clean all old worker sync records
        const wsDel = await WorkerSync.deleteMany({});
        console.log("Cleaned " + wsDel.deletedCount + " old worker sync records.");

        // Mark migration as done so it never runs again
        await Meta.findOneAndUpdate(
          { key: "superadmin_migration_v1" },
          { key: "superadmin_migration_v1", version: 1 },
          { upsert: true }
        );
        console.log("Migration complete! Dashboard is clean for live work.");
      }
    } catch (migErr) {
      console.error("Migration error (non-fatal):", migErr.message);
    }
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err?.message);
  });
