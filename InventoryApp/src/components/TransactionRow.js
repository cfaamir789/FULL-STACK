import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

export default function TransactionRow({
  item,
  onEdit,
  onDelete,
  canEdit = false,
  canDelete = false,
}) {
  const synced = item.synced === 1;
  const date = new Date(item.timestamp);
  const timeStr =
    date.toLocaleDateString() +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        {/* Top line: item code + worker badge */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            {item.item_code && item.item_code.trim() !== "" ? (
              <Text style={styles.itemCode}>{item.item_code}</Text>
            ) : null}
            <Text style={styles.itemName} numberOfLines={1}>
              {item.item_name}
            </Text>
          </View>
          {item.worker_name && item.worker_name !== "unknown" ? (
            <View style={styles.workerBadge}>
              <MaterialCommunityIcons
                name="account-circle"
                size={14}
                color={Colors.primary}
              />
              <Text style={styles.workerText} numberOfLines={1}>
                {item.worker_name}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.barcode}>{item.item_barcode}</Text>

        {/* Bin + Qty row */}
        <View style={styles.metaRow}>
          <View style={styles.binPill}>
            <Text style={styles.binLabel}>{item.frombin}</Text>
            <MaterialCommunityIcons
              name="arrow-right"
              size={12}
              color={Colors.textSecondary}
            />
            <Text style={styles.binLabel}>{item.tobin}</Text>
          </View>
          <View style={styles.qtyPill}>
            <Text style={styles.qtyLabel}>QTY {item.qty}</Text>
          </View>
        </View>

        <Text style={styles.time}>{timeStr}</Text>
      </View>

      <View style={styles.right}>
        {(canEdit || canDelete) && (
          <View style={styles.actions}>
            {canEdit && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => onEdit(item)}
              >
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={18}
                  color={Colors.primary}
                />
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  { backgroundColor: Colors.error + "10" },
                ]}
                onPress={() => onDelete && onDelete(item)}
              >
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={18}
                  color={Colors.error}
                />
              </TouchableOpacity>
            )}
          </View>
        )}
        <View
          style={[
            styles.badge,
            {
              backgroundColor: synced
                ? Colors.success + "20"
                : Colors.pending + "20",
            },
          ]}
        >
          <MaterialCommunityIcons
            name={synced ? "check-circle" : "clock-outline"}
            size={14}
            color={synced ? Colors.success : Colors.pending}
          />
          <Text
            style={[
              styles.badgeText,
              { color: synced ? Colors.success : Colors.pending },
            ]}
          >
            {synced ? "Synced" : "Pending"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 5,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  info: { flex: 1, marginRight: 8, minWidth: 0 },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  itemCode: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primary,
    letterSpacing: 0.3,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginTop: 1,
  },
  barcode: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
    fontFamily: "monospace",
  },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8 },
  binPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  binLabel: { fontSize: 11, fontWeight: "600", color: Colors.textSecondary },
  qtyPill: {
    backgroundColor: Colors.primary + "15",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  qtyLabel: { fontSize: 11, fontWeight: "700", color: Colors.primary },
  workerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary + "10",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 3,
    marginLeft: 8,
    maxWidth: 124,
  },
  workerText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primary,
    flexShrink: 1,
  },
  time: { fontSize: 10, color: Colors.textLight, marginTop: 4 },
  right: { alignItems: "flex-end", justifyContent: "space-between", minWidth: 78 },
  actions: { flexDirection: "row", gap: 4 },
  actionBtn: {
    padding: 5,
    borderRadius: 8,
    backgroundColor: Colors.background,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10, fontWeight: "700", marginLeft: 3 },
});
