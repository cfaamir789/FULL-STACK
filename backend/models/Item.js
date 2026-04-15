const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema({
  ItemCode: String,
  Barcode: { type: String, unique: true, required: true },
  Item_Name: String,
  UOM: { type: String, default: "PCS" },
  updatedAt: { type: Date, default: Date.now },
});

itemSchema.index({ Item_Name: 1 });
itemSchema.index({ ItemCode: 1 });
itemSchema.index({ updatedAt: 1 }); // fast delta queries

module.exports = mongoose.model("Item", itemSchema);
