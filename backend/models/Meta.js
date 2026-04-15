const mongoose = require("mongoose");

const metaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  version: { type: Number, default: 0 },
  value: { type: mongoose.Schema.Types.Mixed }, // generic value slot (e.g. lastFullReplace date)
});

module.exports = mongoose.model("Meta", metaSchema);
