const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  clientTxId: { type: String, unique: true, sparse: true },
  clientUpdatedAt: Date,
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
  syncStatus: {
    type: String,
    enum: ["pending", "processed", "archived"],
    default: "pending",
  },
  processedAt: Date,
  processedBy: String,
  erpDocument: String,
  erpBatch: String,
  archivedAt: Date,
  lastSyncedAt: Date,
  createdAt: { type: Date, default: Date.now },
});

transactionSchema.index({ syncStatus: 1, Timestamp: -1 });
transactionSchema.index({ Worker_Name: 1, syncStatus: 1, Timestamp: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
