const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  pin_hash: { type: String, required: true },
  role: {
    type: String,
    enum: ["superadmin", "admin", "worker"],
    default: "worker",
  },
  recoveryKeys: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
