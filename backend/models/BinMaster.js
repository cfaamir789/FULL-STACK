const mongoose = require("mongoose");

// BinMaster — the permanent list of every physical bin in the warehouse.
// Bins are NEVER deleted (only new bins are added).
// BinRanking and ZoneCode can change (rare), but BinCode is immutable.
const binMasterSchema = new mongoose.Schema({
  BinCode:    { type: String, required: true, unique: true },
  BinRanking: { type: Number, required: true },
  ZoneCode:   { type: String, default: "" },
  updatedAt:  { type: Date, default: Date.now },
});

binMasterSchema.index({ ZoneCode: 1 });
binMasterSchema.index({ BinRanking: 1 });

module.exports = mongoose.model("BinMaster", binMasterSchema);
