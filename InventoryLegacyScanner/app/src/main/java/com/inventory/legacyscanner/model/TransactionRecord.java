package com.inventory.legacyscanner.model;

import com.google.gson.JsonObject;

public class TransactionRecord {
    public long id;
    public String itemBarcode;
    public String itemCode;
    public String itemName;
    public String fromBin;
    public String toBin;
    public int qty;
    public String timestamp;
    public int synced;
    public String workerName;
    public String notes;
    public String clientTxId;
    public String updatedAt;

    public JsonObject toSyncJson(String deviceId) {
        JsonObject jsonObject = new JsonObject();
        jsonObject.addProperty("Client_Tx_Id", clientTxId);
        jsonObject.addProperty("UpdatedAt", updatedAt);
        jsonObject.addProperty("Item_Barcode", itemBarcode);
        jsonObject.addProperty("Item_Code", itemCode);
        jsonObject.addProperty("Item_Name", itemName);
        jsonObject.addProperty("Frombin", fromBin);
        jsonObject.addProperty("Tobin", toBin);
        jsonObject.addProperty("Qty", qty);
        jsonObject.addProperty("Timestamp", timestamp);
        jsonObject.addProperty("Notes", notes == null ? "" : notes);
        jsonObject.addProperty("deviceId", deviceId);
        return jsonObject;
    }
}
