const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  Item_Barcode: String,
  Item_Code: String,
  Item_Name: String,
  Frombin: String,
  Tobin: String,
  Qty: Number,
  Timestamp: Date,
  Notes: String,
  deviceId: String,
  Worker_Name: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transaction", transactionSchema);
