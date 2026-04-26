const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const BinContent = require("../models/BinContent");
const CategoryMaster = require("../models/CategoryMaster");
const TargetPlan = require("../models/TargetPlan");
const Transaction = require("../models/Transaction");

/**
 * GET /api/reports/refill?lowThreshold=12
 *
 * Task 1A � NO DISPLAY : items with upper stock (BinRanking<0) and zero display presence
 * Task 1B � LOW STOCK  : items with upper stock and total display qty < lowThreshold
 * Task 2  � CONSOLIDATE: items appearing in 2+ display bins simultaneously
 *
 * Exclusions: isDeleted, notInMaster, CategoryCode "900", BinRanking 0
 */
router.get("/refill", requireAuth, async (req, res) => {
  try {
    const displayThreshold = Math.max(0, parseInt(req.query.displayThreshold, 10) || 0);
    const displayOp = req.query.displayOp === 'gt' ? '$gt' : '$lt';
    
    const upperThreshold = Math.max(0, parseInt(req.query.upperThreshold, 10) || 0);
    const upperOp = req.query.upperOp === 'gt' ? '$gt' : '$lt';

    const upperLimit = parseInt(req.query.upperLimit, 10) || 0;

    const baseMatch = {
      isDeleted:    { $ne: true },
      notInMaster:  { $ne: true },
      BinRanking:   { $ne: 0 },
      CategoryCode: { $ne: "900" },
    };

    const groupStage = {
      $group: {
        _id:          "$ItemCode",
        ItemCode:     { $first: "$ItemCode" },
        Item_Name:    { $first: "$Item_Name" },
        CategoryCode: { $first: "$CategoryCode" },
        Barcode:      { $first: "$Barcode" },
        allBins: {
          $push: { BinCode: "$BinCode", BinRanking: "$BinRanking", Qty: "$Qty" },
        },
      },
    };

    const splitBins = {
      $addFields: {
        upperBins: {
          $filter: { input: "$allBins", as: "b", cond: { $lt: ["$$b.BinRanking", 0] } },
        },
        displayBins: {
          $filter: {
            input: "$allBins",
            as: "b",
            cond: { $and: [{ $gt: ["$$b.BinRanking", 0] }, { $gt: ["$$b.Qty", 0] }] },
          },
        },
      },
    };

    const addQtyTotals = {
      $addFields: {
        totalUpperQty:   { $sum: "$upperBins.Qty" },
        totalDisplayQty: { $sum: "$displayBins.Qty" },
      },
    };

    const [raw1a, raw1b, raw2, categories] = await Promise.all([

      BinContent.aggregate([
        { $match: baseMatch },
        groupStage,
        splitBins,
        addQtyTotals,
        {
          $match: {
            $expr: {
              $and: [
                { $gt: [{ $size: "$upperBins" }, 0] },
                { $eq: [{ $size: "$displayBins" }, 0] },
              ],
            },
          },
        },
        {
          $project: {
            _id: 0, ItemCode: 1, Item_Name: 1, CategoryCode: 1, Barcode: 1,
            upperBins: 1, totalUpperQty: 1,
          },
        },
        { $sort: { CategoryCode: 1, Item_Name: 1 } },
      ]),

      BinContent.aggregate([
        { $match: baseMatch },
        groupStage,
        splitBins,
        addQtyTotals,
        {
          $match: {
            $expr: {
              $and: [
                { $gt: [{ $size: "$upperBins" }, 0] },
                { $gt: [{ $size: "$displayBins" }, 0] },
                
                
              ],
            },
          },
        },
        {
          $project: {
            _id: 0, ItemCode: 1, Item_Name: 1, CategoryCode: 1, Barcode: 1,
            upperBins: 1, displayBins: 1, totalUpperQty: 1, totalDisplayQty: 1,
          },
        },
        { $sort: { CategoryCode: 1, Item_Name: 1 } },
      ]),

      BinContent.aggregate([
        {
          $match: {
            ...baseMatch,
            BinRanking: { $gt: 0 },
            Qty:        { $gt: 0 },
          },
        },
        {
          $group: {
            _id:          "$ItemCode",
            ItemCode:     { $first: "$ItemCode" },
            Item_Name:    { $first: "$Item_Name" },
            CategoryCode: { $first: "$CategoryCode" },
            Barcode:      { $first: "$Barcode" },
            displayBins: {
              $push: { BinCode: "$BinCode", BinRanking: "$BinRanking", Qty: "$Qty" },
            },
          },
        },
        { $match: { $expr: { $gte: [{ $size: "$displayBins" }, 2] } } },
        {
          $addFields: {
            binCount:        { $size: "$displayBins" },
            totalDisplayQty: { $sum: "$displayBins.Qty" },
          },
        },
        {
          $project: {
            _id: 0, ItemCode: 1, Item_Name: 1, CategoryCode: 1, Barcode: 1,
            displayBins: 1, binCount: 1, totalDisplayQty: 1,
          },
        },
        { $sort: { CategoryCode: 1, Item_Name: 1 } },
      ]),

      CategoryMaster.find({}, "categoryCode categoryName picker buyer").lean(),
    ]);

    const catMap = {};
    for (const c of categories) {
      catMap[c.categoryCode] = {
        name:   c.categoryName || c.categoryCode,
        picker: c.picker       || "Unassigned",
        buyer:  c.buyer        || "",
      };
    }

    function enrich(items, applyUpperFilter = false, applyDisplayFilter = false) {
      return items
        .map((item) => {
          if (item.upperBins && item.upperBins.length > 0) {
            item.upperBins.sort((a, b) => b.Qty - a.Qty);
            if (upperLimit > 0) {
              item.upperBins = item.upperBins.slice(0, upperLimit);
              item.totalUpperQty = item.upperBins.reduce((sum, b) => sum + b.Qty, 0);
            }
          }
          const cat = catMap[item.CategoryCode] || {
            name: item.CategoryCode, picker: "Unassigned", buyer: "",
          };
          return { ...item, categoryName: cat.name, picker: cat.picker, buyer: cat.buyer };
        })
        .filter((item) => {
          if (applyUpperFilter && typeof item.totalUpperQty !== 'undefined') {
            if (upperOp === '$gt' && item.totalUpperQty <= upperThreshold) return false;
            if (upperOp === '$lt' && item.totalUpperQty >= upperThreshold) return false;
          }
          if (applyDisplayFilter && typeof item.totalDisplayQty !== 'undefined') {
            if (displayOp === '$gt' && item.totalDisplayQty <= displayThreshold) return false;
            if (displayOp === '$lt' && item.totalDisplayQty >= displayThreshold) return false;
          }
          return true;
        })
        .sort((a, b) =>
          a.picker.localeCompare(b.picker) || a.Item_Name.localeCompare(b.Item_Name)
        );
    }

    function groupByPicker(items) {
      return items.reduce((acc, item) => {
        (acc[item.picker] = acc[item.picker] || []).push(item);
        return acc;
      }, {});
    }

    const items1a = enrich(raw1a, true, false);  // 1A = No display, so don't filter displayQty
    const items1b = enrich(raw1b, true, true);
    const items2  = enrich(raw2, false, false);
    const allPickers = [
      ...new Set([
        ...items1a.map((i) => i.picker),
        ...items1b.map((i) => i.picker),
        ...items2.map((i)  => i.picker),
      ]),
    ].sort();

    const pickerSummary = {};
    for (const p of allPickers) {
      pickerSummary[p] = { noDisplay: 0, lowDisplay: 0, consolidation: 0 };
    }
    for (const i of items1a) pickerSummary[i.picker].noDisplay++;
    for (const i of items1b) pickerSummary[i.picker].lowDisplay++;
    for (const i of items2)  pickerSummary[i.picker].consolidation++;

    res.json({
      generatedAt:      new Date().toISOString(),
      displayOp:        req.query.displayOp === 'gt' ? 'gt' : 'lt',
      displayThreshold,
      upperOp:          req.query.upperOp === 'gt' ? 'gt' : 'lt',
      upperThreshold,
      upperLimit,
      pickerSummary,
      task1a: { total: items1a.length, byPicker: groupByPicker(items1a) },
      task1b: { total: items1b.length, byPicker: groupByPicker(items1b) },
      task2:  { total: items2.length,  byPicker: groupByPicker(items2)  },
    });
  } catch (err) {
    console.error("Reports /refill error:", err);
    res.status(500).json({ success: false, error: "Failed to generate report." });
  }
});

// Publish the generated report as today's Active Target
router.post("/publish", requireAuth, async (req, res) => {
  try {
    const { reportData, filtersUsed, pickerSummary } = req.body;
    
    // Archive all previously active targets
    await TargetPlan.updateMany({ status: "active" }, { status: "archived" });
    
    // Create new target
    const newTarget = new TargetPlan({
      status: "active",
      publishedAt: new Date(),
      filtersUsed,
      reportData,
      pickerSummary
    });
    await newTarget.save();
    res.json({ success: true, targetId: newTarget._id, publishedAt: newTarget.publishedAt });
  } catch (err) {
    console.error("Publish Target error:", err);
    res.status(500).json({ success: false, error: "Failed to publish target plan." });
  }
});

// Fetch current active plan
router.get("/active-plan", requireAuth, async (req, res) => {
  try {
    const activeTarget = await TargetPlan.findOne({ status: "active" }).sort({ publishedAt: -1 });
    if (!activeTarget) {
      return res.json({ success: false, message: "No active target plan found." });
    }
    res.json({ success: true, target: activeTarget });
  } catch (err) {
    console.error("Get Active Target error:", err);
    res.status(500).json({ success: false, error: "Failed to get active target." });
  }
});

// Calculate live KPI progress for active plan
router.get("/kpi-progress", requireAuth, async (req, res) => {
  try {
    const activeTarget = await TargetPlan.findOne({ status: "active" }).sort({ publishedAt: -1 });
    if (!activeTarget) {
      return res.json({ success: false, message: "No active plan found." });
    }

    const { publishedAt, reportData } = activeTarget;
    
    // Get all completed item arrays for assignment checks
    const targetItems = new Set();
    const taskIdsMap = {}; // mapping by task itemcode -> Incharge

    const collectTasks = (tasksByPicker, taskType) => {
      Object.entries(tasksByPicker).forEach(([picker, items]) => {
        items.forEach(i => {
           targetItems.add(i.Item_Code);
           if (!taskIdsMap[i.Item_Code]) taskIdsMap[i.Item_Code] = {};
           taskIdsMap[i.Item_Code][taskType] = picker; // store who owns it
        });
      });
    };

    if (reportData.task1a && reportData.task1a.byPicker) collectTasks(reportData.task1a.byPicker, 'task1a');
    if (reportData.task1b && reportData.task1b.byPicker) collectTasks(reportData.task1b.byPicker, 'task1b');
    if (reportData.task2 && reportData.task2.byPicker) collectTasks(reportData.task2.byPicker, 'task2');

    // Query transactions that occurred after publication
    const txs = await Transaction.find({
      Timestamp: { $gte: publishedAt },
      Item_Code: { $in: Array.from(targetItems) }
    }).lean();

    // Grouping progress per Incharge
    const progressByIncharge = {}; // e.g. Shoaib: { completedItems: Set, helpers: { Nihal: count } }
    
    for (const tx of txs) {
      const ic = tx.Item_Code;
      const worker = tx.Worker_Name || "Unknown";
      const assignedToAny = taskIdsMap[ic];
      
      // If we find expected owners for the task, register a completion hit
      // We will count it complete for ALL task types this item was present in
      if (assignedToAny) {
         Object.values(assignedToAny).forEach(owner => {
            if (!progressByIncharge[owner]) {
               progressByIncharge[owner] = { hitItems: new Set(), totalCompleted: 0, byExecutors: {} };
            }
            if (!progressByIncharge[owner].hitItems.has(ic)) {
              // mark as completed for owner's zone
              progressByIncharge[owner].hitItems.add(ic);
              progressByIncharge[owner].totalCompleted++;
              
              progressByIncharge[owner].byExecutors[worker] = (progressByIncharge[owner].byExecutors[worker] || 0) + 1;
            }
         });
      }
    }

    // Convert Set logic to array/numbers
    const result = {};
    for (const [owner, meta] of Object.entries(progressByIncharge)) {
       result[owner] = {
         totalCompleted: meta.totalCompleted,
         byExecutors: meta.byExecutors
       };
    }

    res.json({ success: true, progress: result });
  } catch (err) {
    console.error("KPI Progress error:", err);
    res.status(500).json({ success: false, error: "Failed to calculate KPI progress." });
  }
});

module.exports = router;
