const mongoose = require('mongoose');

const metaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  version: { type: Number, default: 0 }
});

module.exports = mongoose.model('Meta', metaSchema);