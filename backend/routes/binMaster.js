const express = require("express");
const router = express.Router();
const multer = require("multer");
const Papa = require("papaparse");
const BinMaster = require("../models/BinMaster");
const BinContent = require("../models/BinContent");
const Meta = require("../models/Meta");
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

// ─── Bin Master Version Tracking ──────────────────────────────────────────────
async function getBinMasterVersion() {
  const doc = await Meta.findOne({ key: "binMasterVersion" }).lean();
  return doc ? doc.version : 0;
}

async function bumpBinMasterVersion() {
  const doc = await Meta.findOneAndUpdate(
    { key: "binMasterVersion" },
    { $inc: { version: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return doc.version;
}

// Derive a human-readable zone label from BinRanking when CSV ZoneCode is absent.
function rankingToZone(ranking) {
  if (ranking > 0) return "Display";
  if (ranking < 0) return "Upper";
  return "Floor";
}

// Derive Aisle and Chamber from a BinCode.
// Chamber A: A1–A12, Chamber B: B13–B24, Chamber C: C25–C36
// High Value: HV01, HV02, ...
// Bulk Warehouse: WH01, WH02, ...
// All other codes (SHIP, Z1, IN0001, etc.) → { aisle: null, chamber: null }
function deriveAisleAndChamber(binCode) {
  if (!binCode) return { aisle: null, chamber: null };
  const code = String(binCode).trim().toUpperCase();
  if (/^HV\d+$/.test(code)) return { aisle: null, chamber: "High Value" };
  if (/^WH\d+$/.test(code)) return { aisle: null, chamber: "Bulk Warehouse" };
  // Standard bin format: [A-C][1-2 digit number][4 digit location][trailing letter]
  // e.g. A100101A, B141402B, C250101A
  const m = code.match(/^([ABC])(\d{1,2})\d{4}[A-Z]$/);
  if (!m) return { aisle: null, chamber: null };
  const letter = m[1];
  const num = parseInt(m[2], 10);
  const aisle = letter + num;
  if (letter === "A" && num >= 1 && num <= 12)
    return { aisle, chamber: "Chamber A" };
  if (letter === "B" && num >= 13 && num <= 24)
    return { aisle, chamber: "Chamber B" };
  if (letter === "C" && num >= 25 && num <= 36)
    return { aisle, chamber: "Chamber C" };
  return { aisle, chamber: null };
}

// Pattern for bins that are valid for workers to use.
// Excludes NAV ERP system bins (SHIP, Z1, IN0001, B0001, etc.)
const WORKER_BIN_PATTERN = /^([ABC]\d{1,2}\d{4}[A-Z]|HV\d+|WH\d+)$/;

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

// GET /api/bin-master/all
router.get("/all", async (req, res) => {
  try {
    const rawBins = await BinMaster.find(
      {},
      { _id: 0, BinCode: 1, BinRanking: 1, ZoneCode: 1 },
    ).lean();
    const bins = rawBins.map((b) => {
      const { aisle, chamber } = deriveAisleAndChamber(b.BinCode);
      const zone = rankingToZone(b.BinRanking || 0);
      return { ...b, Aisle: aisle, Chamber: chamber, Zone: zone };
    });
    res.json({ success: true, bins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

    const [rawBins, total] = await Promise.all([
      BinMaster.find(query, { _id: 0, BinCode: 1, BinRanking: 1, ZoneCode: 1 })
        .sort({ BinCode: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BinMaster.countDocuments(query),
    ]);
    const bins = rawBins.map((b) => {
      const { aisle, chamber } = deriveAisleAndChamber(b.BinCode);
      return { ...b, Aisle: aisle, Chamber: chamber };
    });
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

      // Bump bin master version so phones know to re-download
      const newVersion = await bumpBinMasterVersion();

      // Broadcast to admin dashboards
      const broadcast = req.app.get("broadcast");
      if (broadcast)
        broadcast("bin_master_updated", {
          total,
          upserted,
          modified,
          cascaded,
          version: newVersion,
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

// GET /api/bin-master/codes
// Returns a flat list of ALL bin codes in the bin master (no filtering).
// Includes a version number so phones can skip re-download when unchanged.
router.get("/codes", async (req, res) => {
  try {
    const [allBins, version] = await Promise.all([
      BinMaster.find({}, { _id: 0, BinCode: 1 }).lean(),
      getBinMasterVersion(),
    ]);
    const codes = allBins.map((b) => String(b.BinCode).trim()).filter(Boolean);
    res.json({ success: true, codes, total: codes.length, version });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bin-master/version
// Quick version check — phones call this to decide if they need to re-download.
router.get("/version", async (req, res) => {
  try {
    const [total, version] = await Promise.all([
      BinMaster.countDocuments(),
      getBinMasterVersion(),
    ]);
    res.json({ success: true, total, version });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
