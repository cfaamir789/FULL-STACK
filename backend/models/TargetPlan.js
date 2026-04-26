const mongoose = require("mongoose");

const targetPlanSchema = new mongoose.Schema({
  publishedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["active", "archived"], default: "active" },
  filtersUsed: {
    displayThreshold: Number,
    displayOp: String,
    upperThreshold: Number,
    upperOp: String,
    upperLimit: Number
  },
  reportData: mongoose.Schema.Types.Mixed, // The actual report snapshot
  pickerSummary: mongoose.Schema.Types.Mixed
});

module.exports = mongoose.model("TargetPlan", targetPlanSchema);