const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    ItemCode: { type: String, required: true, trim: true },
    Barcode: { type: String, required: true, unique: true, trim: true },
    Item_Name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

itemSchema.index({ Item_Name: 'text' });
itemSchema.index({ Barcode: 1 });

module.exports = mongoose.model('Item', itemSchema);
