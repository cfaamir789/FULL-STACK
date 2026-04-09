package com.inventory.legacyscanner.model;

import com.google.gson.JsonObject;

public class ItemRecord {
    public final String itemCode;
    public final String barcode;
    public final String itemName;

    public ItemRecord(String itemCode, String barcode, String itemName) {
        this.itemCode = itemCode == null ? "" : itemCode.trim();
        this.barcode = barcode == null ? "" : barcode.trim();
        this.itemName = itemName == null ? "" : itemName.trim();
    }

    public static ItemRecord fromJson(JsonObject jsonObject) {
        return new ItemRecord(
                getString(jsonObject, "ItemCode"),
                getString(jsonObject, "Barcode"),
                getString(jsonObject, "Item_Name")
        );
    }

    private static String getString(JsonObject jsonObject, String key) {
        if (jsonObject == null || !jsonObject.has(key) || jsonObject.get(key).isJsonNull()) {
            return "";
        }
        return jsonObject.get(key).getAsString();
    }
}
