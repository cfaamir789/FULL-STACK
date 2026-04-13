/**
 * One-time migration script:
 * 1. Upgrades AAMIR to superadmin role with a recovery key
 * 2. Cleans all old test/demo transactions and worker sync records
 *
 * Run: node migrate_superadmin.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");
const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set in .env");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    family: 4,
  });
  console.log("Connected!\n");

  const User = require("./models/User");
  const Transaction = require("./models/Transaction");
  const WorkerSync = require("./models/WorkerSync");

  // Step 1: Upgrade AAMIR to superadmin
  const aamir = await User.findOne({ username: "AAMIR" });
  if (aamir) {
    const recoveryKey = crypto.randomBytes(16).toString("hex");
    aamir.role = "superadmin";
    aamir.recoveryKey = recoveryKey;
    await aamir.save();
    console.log("=== AAMIR upgraded to SUPER ADMIN ===");
    console.log("Recovery Key: " + recoveryKey);
    console.log("SAVE THIS KEY! You need it if you forget your PIN.\n");
  } else {
    console.log("WARNING: User AAMIR not found. Make sure to login or register AAMIR first.\n");
  }

  // Step 2: Clean all old transactions
  const txCount = await Transaction.countDocuments({});
  if (txCount > 0) {
    await Transaction.deleteMany({});
    console.log("Deleted " + txCount + " old transactions.");
  } else {
    console.log("No transactions to clean.");
  }

  // Step 3: Clean all worker sync records
  const wsCount = await WorkerSync.countDocuments({});
  if (wsCount > 0) {
    await WorkerSync.deleteMany({});
    console.log("Deleted " + wsCount + " old worker sync records.");
  } else {
    console.log("No worker sync records to clean.");
  }

  console.log("\n=== Migration complete! Dashboard is clean for live work. ===");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
