const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  ItemCode: String,
  Barcode: { type: String, unique: true, required: true },
  Item_Name: String,
});

itemSchema.index({ Item_Name: 1 });
itemSchema.index({ ItemCode: 1 });

module.exports = mongoose.model('Item', itemSchema);
