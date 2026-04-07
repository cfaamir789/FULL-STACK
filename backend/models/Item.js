const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  ItemCode: String,
  Barcode: { type: String, unique: true, required: true },
  Item_Name: String,
});

module.exports = mongoose.model('Item', itemSchema);
