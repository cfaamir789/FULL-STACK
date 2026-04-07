const mongoose = require('mongoose');

const connectDB = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const uri = process.env.MONGODB_URI;
      if (!uri) throw new Error("MONGODB_URI is not defined in .env");
      console.log('Connecting to MongoDB... (attempt ' + (i + 1) + ')');
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
      });
      console.log('MongoDB Connected Successfully!');
      return;
    } catch (err) {
      console.error('MongoDB connection attempt ' + (i + 1) + ' failed:', err.message);
      if (i < retries - 1) {
        const wait = Math.min(5000 * (i + 1), 15000);
        console.log('Retrying in ' + (wait / 1000) + 's...');
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  console.error('FATAL: Could not connect to MongoDB after ' + retries + ' attempts');
  process.exit(1);
};

module.exports = connectDB;
