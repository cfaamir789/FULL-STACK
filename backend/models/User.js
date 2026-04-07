const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  pin_hash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'worker'], default: 'worker' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);