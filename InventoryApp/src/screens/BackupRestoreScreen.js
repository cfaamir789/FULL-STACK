import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";

import { getAllTransactions } from "../database/db";
import Colors from "../theme/colors";

const IS_WEB = Platform.OS === "web";
let backupSvc = null;
if (!IS_WEB) {
  backupSvc = require("../services/backupService");
}

const formatSize = (bytes) => {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function BackupRestoreScreen() {
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState([]);
  const [working, setWorking] = useState(false);

  const loadBackups = useCallback(async () => {
    if (IS_WEB || !backupSvc) return;
    setLoading(true);
    try {
      const rows = await backupSvc.listBackupsDetailed();
      setBackups(rows);
    } catch (err) {
      Alert.alert("Error", err.message || "Could not load backups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBackups();
    }, [loadBackups]),
  );

  const showRestoreOptions = (file) => {
    Alert.alert(
      "Restore Backup",
      `${file.name}\n\nMerge keeps current phone rows and adds missing ones. Replace clears this phone first, then restores the selected backup.\n\nServer data is not touched.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge Restore",
          onPress: () => runRestore(file, false),
        },
        {
          text: "Replace Phone",
          style: "destructive",
          onPress: () => runRestore(file, true),
        },
      ],
    );
  };

  const runRestore = async (file, replaceExisting) => {
    if (!backupSvc) return;
    setWorking(true);
    try {
      const result = await backupSvc.restoreBackupFromFile(file.uri, {
        replaceExisting,
        fileName: file.name,
      });
      Alert.alert(
        "Restore Complete",
        `Rows read: ${result.total}\nInserted: ${result.inserted}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}`,
      );
      await loadBackups();
    } catch (err) {
      Alert.alert("Restore Failed", err.message || "Could not restore backup.");
    } finally {
      setWorking(false);
    }
  };

  const handlePickBackup = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return;
    const file = result.assets?.[0];
    if (!file?.uri) return;
    showRestoreOptions({ uri: file.uri, name: file.name || "backup.csv" });
  };

  const handleCreateBackup = async () => {
    if (!backupSvc) return;
    setWorking(true);
    try {
      const username = (await AsyncStorage.getItem("workerName")) || "backup";
      const transactions = await getAllTransactions();
      if (!transactions.length) {
        Alert.alert("No Data", "This phone has no transactions to back up.");
        return;
      }
      const { filename } = await backupSvc.saveBackup(
        transactions,
        username,
        "csv",
        false,
      );
      await loadBackups();
      Alert.alert(
        "Backup Saved",
        `${transactions.length} transaction(s) saved as:\n${filename}`,
      );
    } catch (err) {
      Alert.alert("Backup Failed", err.message || "Could not create backup.");
    } finally {
      setWorking(false);
    }
  };

  if (IS_WEB) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons
          name="monitor-cellphone-star"
          size={48}
          color={Colors.textLight}
        />
        <Text style={styles.webTitle}>Restore runs on the Android app</Text>
        <Text style={styles.webText}>
          This screen is for phone backups stored in the app folder. Use the
          Android build to restore a device directly.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Disaster Recovery</Text>
        <Text style={styles.infoText}>
          Backups now include restore-ready IDs and timestamps. Restoring here
          only changes this phone. Shared server history stays untouched.
        </Text>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.primaryBtn, working && styles.btnDisabled]}
          onPress={handleCreateBackup}
          disabled={working}
        >
          {working ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialCommunityIcons
              name="content-save"
              size={18}
              color="#fff"
            />
          )}
          <Text style={styles.primaryBtnText}>Create Backup Now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, working && styles.btnDisabled]}
          onPress={handlePickBackup}
          disabled={working}
        >
          <MaterialCommunityIcons
            name="folder-open-outline"
            size={18}
            color={Colors.primary}
          />
          <Text style={styles.secondaryBtnText}>Choose Backup File</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>InventoryManager Folder</Text>
        <TouchableOpacity onPress={loadBackups} disabled={loading || working}>
          <MaterialCommunityIcons
            name="refresh"
            size={20}
            color={Colors.primary}
          />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : backups.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons
            name="folder-remove-outline"
            size={28}
            color={Colors.textLight}
          />
          <Text style={styles.emptyTitle}>No local backups found</Text>
          <Text style={styles.emptyText}>
            Create a backup now or choose a CSV/XLSX backup file from storage.
          </Text>
        </View>
      ) : (
        backups.map((file) => (
          <View key={file.uri} style={styles.fileCard}>
            <View style={styles.fileHeader}>
              <View style={styles.fileMeta}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {file.name}
                </Text>
                <Text style={styles.fileSub}>
                  {file.modifiedAt
                    ? new Date(file.modifiedAt).toLocaleString()
                    : "Unknown date"}
                  {`  •  ${formatSize(file.size)}`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.restoreBtn}
                onPress={() => showRestoreOptions(file)}
                disabled={working}
              >
                <MaterialCommunityIcons
                  name="restore"
                  size={18}
                  color={Colors.success}
                />
                <Text style={styles.restoreBtnText}>Restore</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 32 },
  center: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  webTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
    marginTop: 12,
  },
  webText: {
    marginTop: 8,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  infoCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  infoText: {
    marginTop: 8,
    color: Colors.textSecondary,
    lineHeight: 21,
    fontSize: 13,
  },
  actionsRow: {
    marginTop: 16,
    gap: 12,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + "33",
  },
  secondaryBtnText: {
    color: Colors.primary,
    fontWeight: "800",
    fontSize: 15,
  },
  btnDisabled: { opacity: 0.7 },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  centerBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  emptyText: {
    marginTop: 6,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  fileCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  fileMeta: { flex: 1 },
  fileName: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  fileSub: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.success + "12",
  },
  restoreBtnText: {
    color: Colors.success,
    fontWeight: "800",
    fontSize: 13,
  },
});
