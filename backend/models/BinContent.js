const mongoose = require("mongoose");

const binContentSchema = new mongoose.Schema({
  BinCode: { type: String, required: true },
  ItemCode: { type: String, required: true },
  Item_Name: { type: String, default: "" },
  CategoryCode: { type: String, default: "" },
  Barcode: { type: String, default: "" },
  Qty: { type: Number, default: 0 },
  BinRanking: { type: Number, default: 0 }, // overridden by BinMaster on upload
  ZoneCode: { type: String, default: "" },
  notInMaster: { type: Boolean, default: false }, // true when ItemCode had no Item Master match
  isDeleted: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});

// Unique per bin+item combination
binContentSchema.index({ BinCode: 1, ItemCode: 1 }, { unique: true });
binContentSchema.index({ ItemCode: 1 });
binContentSchema.index({ CategoryCode: 1 });
binContentSchema.index({ BinRanking: 1 });
binContentSchema.index({ ZoneCode: 1 });
binContentSchema.index({ notInMaster: 1 });
binContentSchema.index({ updatedAt: 1 }); // for delta queries later

module.exports = mongoose.model("BinContent", binContentSchema);
