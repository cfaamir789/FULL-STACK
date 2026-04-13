const mongoose = require("mongoose");

const workerSyncSchema = new mongoose.Schema({
  worker: { type: String, required: true, unique: true },
  lastSync: { type: Date, default: Date.now },
  totalToday: { type: Number, default: 0 },
  lastResetDate: { type: String, default: "" },
  clearBefore: { type: Date, default: null },
});

module.exports = mongoose.model("WorkerSync", workerSyncSchema);
