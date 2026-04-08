import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

export default React.memo(function SyncStatusBanner({
  online,
  lastSync,
  pendingCount,
  serverLabel,
}) {
  const isOnline = online === true;
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: isOnline ? Colors.success : Colors.error },
      ]}
    >
      <View style={styles.row}>
        <MaterialCommunityIcons
          name={isOnline ? "cloud-check" : "cloud-off-outline"}
          size={16}
          color="#fff"
        />
        <Text style={styles.text}>
          {isOnline ? " Online" : " Offline"}
          {isOnline && lastSync
            ? `  •  Last sync: ${new Date(lastSync).toLocaleTimeString()}`
            : ""}
          {pendingCount > 0 ? `  •  ${pendingCount} pending` : ""}
        </Text>
      </View>
      {serverLabel ? (
        <Text style={styles.serverText}>Server: {serverLabel}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  text: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  serverText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 11,
    marginTop: 3,
  },
});
