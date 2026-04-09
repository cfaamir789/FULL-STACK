require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const itemsRouter = require("./routes/items");
const syncRouter = require("./routes/sync");
const authRouter = require("./routes/auth");
const connectDB = require("./config/database");

const compression = require("compression");

const app = express();
const PORT = process.env.PORT || 5000;

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
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "local",
    node: process.version,
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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin`);

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
connectDB().catch((err) => {
  console.error("MongoDB connection failed:", err?.message);
});
