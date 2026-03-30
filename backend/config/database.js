const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = {
  items: new Datastore({ filename: path.join(dataDir, 'items.db'), autoload: true }),
  transactions: new Datastore({ filename: path.join(dataDir, 'transactions.db'), autoload: true }),
};

// Unique index on Barcode
db.items.ensureIndex({ fieldName: 'Barcode', unique: true });

module.exports = db;
