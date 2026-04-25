const mongoose = require("mongoose");

const categoryMasterSchema = new mongoose.Schema({
  categoryCode: { type: String, required: true, unique: true, trim: true },
  categoryName: { type: String, default: "", trim: true },
  buyer: { type: String, default: "", trim: true },
  picker: { type: String, default: "", trim: true },
  storeCode: { type: String, default: "", trim: true },
  updatedAt: { type: Date, default: Date.now },
});

categoryMasterSchema.index({ categoryCode: 1 });
categoryMasterSchema.index({ storeCode: 1 });

module.exports = mongoose.model("CategoryMaster", categoryMasterSchema);
