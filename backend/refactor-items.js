const fs = require('fs');
const path = require('path');

const itemsPath = path.join(__dirname, 'routes', 'items.js');
let items = fs.readFileSync(itemsPath, 'utf8');

items = items.replace(
`const db = require("../config/database");
let _itemsVersion = 0;

// Load persisted version on startup
(async () => {
  try {
    const doc = await db.items.findOneAsync({ _meta: "itemsVersion" });
    if (doc) _itemsVersion = doc.version;
  } catch (_) {}
})();

async function bumpItemsVersion() {
  _itemsVersion++;
  await db.items.updateAsync(
    { _meta: "itemsVersion" },
    { $set: { _meta: "itemsVersion", version: _itemsVersion } },
    { upsert: true },
  );
  return _itemsVersion;
}`,
`const Meta = require("../models/Meta");
let _itemsVersion = 0;

// Load persisted version on startup
(async () => {
  try {
    const doc = await Meta.findOne({ key: "itemsVersion" });
    if (doc) _itemsVersion = doc.version;
  } catch (_) {}
})();

async function bumpItemsVersion() {
  _itemsVersion++;
  await Meta.findOneAndUpdate(
    { key: "itemsVersion" },
    { $set: { version: _itemsVersion } },
    { upsert: true, new: true }
  );
  return _itemsVersion;
}`
);

// Remove the `query._meta = { $exists: false };` since `Meta` is separate now
items = items.replace("query._meta = { $exists: false }; // exclude version meta doc", "");

// findAsync -> find
items = items.replace(/Item\.findAsync/g, "Item.find");
items = items.replace(/\.execAsync\(\)/g, "");

// countAsync -> countDocuments
items = items.replace(/Item\.countAsync/g, "Item.countDocuments");

// removeAsync({}, { multi: true }) -> deleteMany({})
items = items.replace(/Item\.removeAsync\(\{\}, \{ multi: true \}\)/g, "Item.deleteMany({})");

// POST / insertAsync -> create
items = items.replace(/Item\.insertAsync/g, "Item.create");

// UpdateAsync handling:
// 1. Single item ADD:
items = items.replace(
`    const { affectedDocuments } = await Item.updateAsync(
      { Barcode },
      { $set: { ItemCode, Barcode, Item_Name } },
      { upsert: true, returnUpdatedDocs: true },
    );`,
`    const affectedDocuments = await Item.findOneAndUpdate(
      { Barcode },
      { $set: { ItemCode, Barcode, Item_Name } },
      { upsert: true, new: true }
    );`
);

// 2. Import items REPLACE/UPSERT loop:
items = items.replace(
`        const { upsert } = await Item.updateAsync(
          { Barcode: item.Barcode },
          {
            $set: {
              ItemCode: item.ItemCode,
              Barcode: item.Barcode,
              Item_Name: item.Item_Name,
            },
          },
          { upsert: true },
        );
        if (upsert) inserted++;
        else modified++;`,
`        const result = await Item.updateOne(
          { Barcode: item.Barcode },
          {
            $set: {
              ItemCode: item.ItemCode,
              Barcode: item.Barcode,
              Item_Name: item.Item_Name,
            },
          },
          { upsert: true }
        );
        if (result.upsertedId) inserted++;
        else modified++;`
);

// 3. Upload CSV upsert loop
items = items.replace(
`      const result = await Item.updateAsync(
        { Barcode: item.Barcode },
        {
          $set: {
            ItemCode: item.ItemCode,
            Barcode: item.Barcode,
            Item_Name: item.Item_Name,
          },
        },
        { upsert: true },
      );
      if (result.upsert) inserted++;
      else modified++;`,
`      const result = await Item.updateOne(
        { Barcode: item.Barcode },
        {
          $set: {
            ItemCode: item.ItemCode,
            Barcode: item.Barcode,
            Item_Name: item.Item_Name,
          },
        },
        { upsert: true }
      );
      if (result.upsertedId) inserted++;
      else modified++;`
);

fs.writeFileSync(itemsPath, items);
console.log("Items route refactored successfully!");
