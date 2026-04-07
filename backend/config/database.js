const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not defined in .env");
    await mongoose.connect(uri);
    console.log('MongoDB Connected Successfully!');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
};

module.exports = connectDB;
