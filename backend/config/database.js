const mongoose = require("mongoose");
const dns = require("dns");

// Force public DNS so mongodb+srv:// SRV lookups don't fail on restrictive local DNS
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// Disable Mongoose buffering globally — queries fail instantly when DB is down
mongoose.set("bufferCommands", false);

const connectDB = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const uri = process.env.MONGODB_URI;
      if (!uri) throw new Error("MONGODB_URI is not defined in .env");
      console.log("Connecting to MongoDB... (attempt " + (i + 1) + ")");
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        connectTimeoutMS: 5000,
        family: 4,
      });
      console.log("MongoDB Connected Successfully!");
      return;
    } catch (err) {
      console.error(
        "MongoDB connection attempt " + (i + 1) + " failed:",
        err.message,
      );
      if (i < retries - 1) {
        const wait = Math.min(3000 * (i + 1), 10000);
        console.log("Retrying in " + wait / 1000 + "s...");
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  console.error(
    "WARNING: Could not connect to MongoDB after " +
      retries +
      " attempts. Server will start without DB.",
  );
  // Keep retrying in background every 15s
  const bgRetry = async () => {
    if (mongoose.connection.readyState === 1) return;
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        connectTimeoutMS: 5000,
        family: 4,
      });
      console.log("MongoDB background reconnect succeeded!");
    } catch (_) {
      setTimeout(bgRetry, 15000);
    }
  };
  setTimeout(bgRetry, 15000);
};

module.exports = connectDB;
