const fs = require('fs');
const path = require('path');

// 1. Refactor auth.js
const authPath = path.join(__dirname, 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');
auth = auth.replace("const db = require('../config/database');", "const User = require('../models/User');");
auth = auth.replace(/db\.users\.findAsync/g, "User.find");
auth = auth.replace(/db\.users\.findOneAsync/g, "User.findOne");
auth = auth.replace(/db\.users\.insertAsync/g, "User.create");
auth = auth.replace(/db\.users\.countAsync/g, "User.countDocuments");
auth = auth.replace(/const removed = await db\.users\.removeAsync\(\{ username \}, \{\}\);/g, "const resObj = await User.deleteOne({ username });\n    const removed = resObj.deletedCount;");
auth = auth.replace(/db\.users\.removeAsync\(\{([^}]*)\}, \{([^}]*)\}\)/g, "User.deleteMany({$1})"); 
auth = auth.replace(/db\.users\.removeAsync\(\{([^}]*)\}\)/g, "User.deleteMany({$1})"); 
auth = auth.replace(/err\.errorType === 'uniqueViolated'/g, "err.code === 11000");
fs.writeFileSync(authPath, auth);

// 2. Refactor sync.js
const syncPath = path.join(__dirname, 'routes', 'sync.js');
let sync = fs.readFileSync(syncPath, 'utf8');
sync = sync.replace(/Transaction\.insertAsync/g, "Transaction.insertMany");
sync = sync.replace(/Transaction\.findAsync/g, "Transaction.find");
sync = sync.replace(/Transaction\.countAsync/g, "Transaction.countDocuments");
sync = sync.replace(/\.execAsync\(\)/g, ""); // Mongoose native promises don't need .execAsync()
sync = sync.replace(/deleted \+= await Transaction\.removeAsync\(\{ _id: id \}, \{\}\);/g, "const res = await Transaction.deleteOne({ _id: id });\n        deleted += res.deletedCount;");
sync = sync.replace(/const deleted = await Transaction\.removeAsync\(\n\s*\{ Worker_Name: worker \},\n\s*\{ multi: true \},\n\s*\);/g, "const resObj = await Transaction.deleteMany({ Worker_Name: worker });\n      const deleted = resObj.deletedCount;");
// findOneAsync update
sync = sync.replace(/Transaction\.findOneAsync/g, "Transaction.findOne");
// updateAsync
sync = sync.replace(/const updated = await Transaction\.updateAsync\(\n\s*\{ _id: req.params.id \},\n\s*\{ \$set: \{ Frombin, Tobin, Qty: Number\(Qty\) \} \},\n\s*\{ returnUpdatedDocs: true \},\n\s*\);/g, "const updated = await Transaction.findByIdAndUpdate( req.params.id, { Frombin, Tobin, Qty: Number(Qty) }, { new: true } );");
// remaining single removeAsync via ID
sync = sync.replace(/await Transaction\.removeAsync\(\{ _id: req\.params\.id \}, \{\}\);/g, "await Transaction.findByIdAndDelete(req.params.id);");
// remaining multi removeAsync
sync = sync.replace(/await Transaction\.removeAsync\(\{\}, \{ multi: true \}\);/g, "await Transaction.deleteMany({});");
fs.writeFileSync(syncPath, sync);

console.log("Auth and Sync refactored successfully!");
