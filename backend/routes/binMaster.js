const express = require("express");
const router = express.Router();
const multer = require("multer");
const Papa = require("papaparse");
const BinMaster = require("../models/BinMaster");
const BinContent = require("../models/BinContent");
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/authMiddleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normHeader(h) {
  return String(h)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Derive a human-readable zone label from BinRanking when CSV ZoneCode is absent.
function rankingToZone(ranking) {
  if (ranking > 0) return "Display";
  if (ranking < 0) return "Upper";
  return "Floor";
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────
// Expected columns: Code, Bin Ranking, Zone Code
// normHeader strips all non-alphanumerics so "Bin Ranking" → "binranking" etc.
function parseBinMasterCsv(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error("CSV parse failed: " + parsed.errors[0].message);
  }
  if (!parsed.data[0]) throw new Error("CSV is empty");

  const firstRow = parsed.data[0];
  const headerMap = {};
  for (const h of Object.keys(firstRow)) headerMap[normHeader(h)] = h;

  // "Code" → "code", "Bin Ranking" → "binranking", "Zone Code" → "zonecode"
  const COL_CODE = headerMap["code"];
  const COL_RANKING = headerMap["binranking"] || headerMap["ranking"];
  const COL_ZONE = headerMap["zonecode"] || headerMap["zone"];

  if (!COL_CODE || !COL_RANKING || !COL_ZONE) {
    throw new Error(
      "CSV must have columns: Code, Bin Ranking, Zone Code. Got: " +
        Object.keys(firstRow).join(", "),
    );
  }

  const rowMap = new Map();
  for (const row of parsed.data) {
    const binCode = String(row[COL_CODE] || "").trim();
    const ranking = parseFloat(
      String(row[COL_RANKING] || "0").replace(/,/g, ""),
    );
    const zoneCode =
      String(row[COL_ZONE] || "").trim() || rankingToZone(ranking);

    if (!binCode || isNaN(ranking)) continue;
    rowMap.set(binCode, {
      BinCode: binCode,
      BinRanking: ranking,
      ZoneCode: zoneCode,
    });
  }

  const rows = Array.from(rowMap.values());
  if (rows.length === 0) throw new Error("No valid rows found in CSV");
  return rows;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/bin-master/stats
router.get("/stats", async (req, res) => {
  try {
    const [total, zones] = await Promise.all([
      BinMaster.countDocuments(),
      BinMaster.distinct("ZoneCode"),
    ]);
    res.json({
      success: true,
      total,
      uniqueZones: zones.filter((z) => z && String(z).trim()).length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-master — paginated list with optional search
router.get("/", async (req, res) => {
  try {
    const q = req.query.q;
    const zone = req.query.zone ? String(req.query.zone).trim() : "";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;

    const conditions = [];
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      conditions.push({ $or: [{ BinCode: regex }, { ZoneCode: regex }] });
    }
    if (zone) conditions.push({ ZoneCode: zone });
    const query =
      conditions.length === 0
        ? {}
        : conditions.length === 1
          ? conditions[0]
          : { $and: conditions };

    const [bins, total] = await Promise.all([
      BinMaster.find(query, { _id: 0, BinCode: 1, BinRanking: 1, ZoneCode: 1 })
        .sort({ BinCode: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BinMaster.countDocuments(query),
    ]);
    res.json({ success: true, bins, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bin-master/upload-csv
// Upserts all bins (never deletes) then cascades BinRanking+ZoneCode to BinContent.
router.post(
  "/upload-csv",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No file uploaded" });
      }

      const csvText = req.file.buffer.toString("utf8");
      const rows = parseBinMasterCsv(csvText);
      const total = rows.length;
      const writeTime = new Date();
      const mode = req.body.mode === "replace" ? "replace" : "merge";

      // Step 1 — Replace All or Merge (upsert)
      let upserted = 0;
      let modified = 0;

      if (mode === "replace") {
        // Wipe BinMaster and re-insert everything fresh
        await BinMaster.deleteMany({});
        const insertOps = rows.map((r) => ({
          insertOne: {
            document: {
              BinCode: r.BinCode,
              BinRanking: r.BinRanking,
              ZoneCode: r.ZoneCode,
              updatedAt: writeTime,
            },
          },
        }));
        for (const chunk of chunkArray(insertOps, 3000)) {
          const result = await BinMaster.collection.bulkWrite(chunk, {
            ordered: false,
          });
          upserted += result.insertedCount || 0;
        }
      } else {
        // Merge — upsert each row (never delete existing bins)
        const masterOps = rows.map((r) => ({
          updateOne: {
            filter: { BinCode: r.BinCode },
            update: {
              $set: {
                BinRanking: r.BinRanking,
                ZoneCode: r.ZoneCode,
                updatedAt: writeTime,
              },
            },
            upsert: true,
          },
        }));
        for (const chunk of chunkArray(masterOps, 3000)) {
          const result = await BinMaster.collection.bulkWrite(chunk, {
            ordered: false,
          });
          upserted += result.upsertedCount || 0;
          modified += result.modifiedCount || 0;
        }
      }

      // Step 2 — Cascade: update matching BinContent records with new BinRanking + ZoneCode
      const cascadeOps = rows.map((r) => ({
        updateMany: {
          filter: { BinCode: r.BinCode },
          update: { $set: { BinRanking: r.BinRanking, ZoneCode: r.ZoneCode } },
        },
      }));

      let cascaded = 0;
      for (const chunk of chunkArray(cascadeOps, 3000)) {
        const result = await BinContent.collection.bulkWrite(chunk, {
          ordered: false,
        });
        cascaded += result.modifiedCount || 0;
      }

      // Broadcast to admin dashboards
      const broadcast = req.app.get("broadcast");
      if (broadcast)
        broadcast("bin_master_updated", {
          total,
          upserted,
          modified,
          cascaded,
        });

      res.json({
        success: true,
        total,
        upserted,
        modified,
        cascaded,
        message:
          `✓ ${total} bins saved (${upserted} new, ${modified} updated). ` +
          `${cascaded} Bin Content records updated.`,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/bin-master/sync-zones
// Backfills ZoneCode into every BinContent record from BinMaster.
// If a BinMaster entry has no ZoneCode it derives one from BinRanking.
// Also patches BinMaster rows that still have an empty ZoneCode.
router.post("/sync-zones", requireAuth, requireAdmin, async (req, res) => {
  try {
    const binMasterDocs = await BinMaster.find(
      {},
      { BinCode: 1, BinRanking: 1, ZoneCode: 1, _id: 0 },
    ).lean();

    if (binMasterDocs.length === 0) {
      return res.json({
        success: false,
        error: "BinMaster is empty — upload Bin List CSV first.",
      });
    }

    // Step 1 — patch BinMaster rows where ZoneCode is missing
    const masterPatchOps = [];
    for (const doc of binMasterDocs) {
      if (!doc.ZoneCode || !String(doc.ZoneCode).trim()) {
        const derived = rankingToZone(doc.BinRanking);
        masterPatchOps.push({
          updateOne: {
            filter: { BinCode: doc.BinCode },
            update: { $set: { ZoneCode: derived } },
          },
        });
        doc.ZoneCode = derived; // keep in-memory map consistent
      }
    }
    if (masterPatchOps.length > 0) {
      for (const chunk of chunkArray(masterPatchOps, 3000)) {
        await BinMaster.collection.bulkWrite(chunk, { ordered: false });
      }
    }

    // Step 2 — cascade into BinContent
    const cascadeOps = binMasterDocs.map((doc) => ({
      updateMany: {
        filter: { BinCode: doc.BinCode },
        update: { $set: { ZoneCode: doc.ZoneCode } },
      },
    }));

    let cascaded = 0;
    for (const chunk of chunkArray(cascadeOps, 3000)) {
      const result = await BinContent.collection.bulkWrite(chunk, {
        ordered: false,
      });
      cascaded += result.modifiedCount || 0;
    }

    const broadcast = req.app.get("broadcast");
    if (broadcast) broadcast("bin_master_updated", { cascaded });

    res.json({
      success: true,
      masterPatched: masterPatchOps.length,
      cascaded,
      message:
        `✓ Zone codes synced. ` +
        `${masterPatchOps.length} BinMaster rows derived from ranking. ` +
        `${cascaded} Bin Content records updated.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
