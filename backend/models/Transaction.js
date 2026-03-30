const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    Item_Barcode: { type: String, required: true, trim: true },
    Item_Name: { type: String, required: true, trim: true },
    Frombin: { type: String, required: true, trim: true },
    Tobin: { type: String, required: true, trim: true },
    Qty: { type: Number, required: true, min: 1 },
    Timestamp: { type: Date, required: true },
    deviceId: { type: String, trim: true, default: 'unknown' },
  },
  { timestamps: true }
);

transactionSchema.index({ Item_Barcode: 1 });
transactionSchema.index({ Timestamp: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
