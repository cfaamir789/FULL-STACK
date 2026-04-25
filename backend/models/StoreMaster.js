const mongoose = require("mongoose");

const storeMasterSchema = new mongoose.Schema({
  storeCode: { type: String, required: true, unique: true, trim: true },
  storeName: { type: String, default: "", trim: true },
  pickingDay: { type: String, default: "", trim: true },
  updatedAt: { type: Date, default: Date.now },
});

storeMasterSchema.index({ storeCode: 1 });

module.exports = mongoose.model("StoreMaster", storeMasterSchema);
