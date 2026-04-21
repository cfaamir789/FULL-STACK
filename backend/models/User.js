const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  pin_hash: { type: String, required: true },
  role: {
    type: String,
    enum: ["superadmin", "admin", "worker", "checker"],
    default: "worker",
  },
  recoveryKeys: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  employeeId: { type: String, default: "" },
  deviceModel: { type: String, default: "" },
  isBlocked: { type: Boolean, default: false },
});

module.exports = mongoose.model("User", userSchema);
