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
  UOM: String,
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
transactionSchema.index({ Timestamp: -1 });
transactionSchema.index({ Worker_Name: 1, Timestamp: -1 });
// Fast stats aggregation — group-by syncStatus
transactionSchema.index({ syncStatus: 1 });
// Processed Items page — sorted by processedAt desc
transactionSchema.index({ syncStatus: 1, processedAt: -1 });
// Worker-status today count — lastSyncedAt range scan
transactionSchema.index({ lastSyncedAt: 1 });
transactionSchema.index({ Worker_Name: 1, lastSyncedAt: 1 });

module.exports = mongoose.model("Transaction", transactionSchema);
