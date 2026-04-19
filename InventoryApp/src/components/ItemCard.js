import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

export default React.memo(function ItemCard({ item, onLoadBarcodes }) {
  const [expanded, setExpanded] = useState(false);
  const [barcodes, setBarcodes] = useState(item.barcodes || []);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  const count = item.barcodeCount || barcodes.length || 1;

  useEffect(() => {
    setBarcodes(item.barcodes || []);
  }, [item.barcodes]);

  const copyValue = async (value, label) => {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        const Clipboard = require("expo-clipboard");
        await Clipboard.setStringAsync(text);
      }
      Alert.alert("Copied", `${label} copied:\n${text}`);
    } catch {
      Alert.alert("Copy Failed", `Could not copy ${label}.`);
    }
  };

  const toggleExpanded = async () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);

    if (
      nextExpanded &&
      barcodes.length === 0 &&
      typeof onLoadBarcodes === "function"
    ) {
      setLoadingBarcodes(true);
      try {
        const loadedBarcodes = await onLoadBarcodes(item);
        setBarcodes(Array.isArray(loadedBarcodes) ? loadedBarcodes : []);
      } finally {
        setLoadingBarcodes(false);
      }
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons
            name="package-variant"
            size={22}
            color={Colors.primary}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {item.item_name}
          </Text>
          <View style={styles.inlineRow}>
            <Text style={styles.sub}>Item Code: {item.item_code}</Text>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => copyValue(item.item_code, "Item code")}
            >
              <MaterialCommunityIcons
                name="content-copy"
                size={14}
                color={Colors.primary}
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>
            {count} barcode{count !== 1 ? "s" : ""}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.viewBtn, expanded && styles.viewBtnActive]}
          onPress={toggleExpanded}
        >
          <MaterialCommunityIcons
            name={expanded ? "chevron-up" : "barcode"}
            size={16}
            color={expanded ? Colors.primary : Colors.primary}
          />
          <Text style={styles.viewBtnText}>{expanded ? "Hide" : "View"}</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={styles.barcodeList}>
          <Text style={styles.barcodeHeader}>All Barcodes ({count})</Text>
          {loadingBarcodes ? (
            <View style={styles.loadingBarcodes}>
              <MaterialCommunityIcons
                name="loading"
                size={16}
                color={Colors.textLight}
              />
              <Text style={styles.loadingBarcodesText}>
                Loading barcodes...
              </Text>
            </View>
          ) : (
            barcodes.map((barcode) => (
              <View key={barcode} style={styles.barcodeRow}>
                <MaterialCommunityIcons
                  name="barcode"
                  size={14}
                  color={Colors.textLight}
                />
                <Text style={styles.barcodeText}>{barcode}</Text>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={() => copyValue(barcode, "Barcode")}
                >
                  <MaterialCommunityIcons
                    name="content-copy"
                    size={14}
                    color={Colors.primary}
                  />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 4,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    overflow: "hidden",
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  info: { flex: 1 },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: { fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  copyBtn: {
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: Colors.primary + "10",
  },
  viewBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
    marginLeft: 8,
  },
  viewBtnActive: { backgroundColor: Colors.primary + "15" },
  viewBtnText: { fontSize: 12, color: Colors.primary, fontWeight: "700" },
  barcodeList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  barcodeHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  barcodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  loadingBarcodes: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  loadingBarcodesText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  barcodeText: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontFamily: "monospace",
  },
});
