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
import Papa from "papaparse";
import { clearAllItems, getDashboardStats, upsertItems } from "../database/db";
import { checkHealth } from "../services/api";
import {
  checkItemMasterUpdate,
  downloadItemMaster,
  checkBinContentUpdate,
  downloadBinContent,
  downloadBinContentDelta,
} from "../services/syncService";
import Colors from "../theme/colors";

const IS_WEB = Platform.OS === "web";
let DocumentPicker = null;
let FileSystem = null;
if (!IS_WEB) {
  DocumentPicker = require("expo-document-picker");
  FileSystem = require("expo-file-system/legacy");
}

export default function ItemMasterScreen() {
  const [localCount, setLocalCount] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [importing, setImporting] = useState(false);
  const [online, setOnline] = useState(false);

  // Bin Content state
  const [binInfo, setBinInfo] = useState(null);
  const [binDownloading, setBinDownloading] = useState(false);
  const [binDeltaLoading, setBinDeltaLoading] = useState(false);
  const [binCheckLoading, setBinCheckLoading] = useState(false);
  const [binProgress, setBinProgress] = useState(null);

  const loadInfo = useCallback(async () => {
    try {
      const stats = await getDashboardStats();
      setLocalCount(stats.totalItems);
    } catch {}
    try {
      await checkHealth();
      setOnline(true);
      const info = await checkItemMasterUpdate();
      setServerInfo(info);
      try {
        const binData = await checkBinContentUpdate();
        setBinInfo(binData);
      } catch {}
    } catch {
      setOnline(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadInfo();
    }, [loadInfo]),
  );

  const handleDownload = async () => {
    setDownloading(true);
    setProgress({ phase: "downloading", percent: 0 });
    try {
      const result = await downloadItemMaster((p) => setProgress(p));
      const stats = await getDashboardStats();
      setLocalCount(stats.totalItems);
      setServerInfo((prev) =>
        prev
          ? { ...prev, localVersion: result.version, updateAvailable: false }
          : prev,
      );
      Alert.alert(
        "Downloaded",
        `${result.count.toLocaleString()} items downloaded (v${result.version}).`,
      );
    } catch (err) {
      Alert.alert("Download Failed", err.message);
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  // ── Bin Content handlers ──────────────────────────────────────────────────

  const handleBinCheckUpdates = async () => {
    setBinCheckLoading(true);
    try {
      const data = await checkBinContentUpdate();
      setBinInfo(data);
      if (data.updateAvailable) {
        Alert.alert(
          "Update Available",
          `Server has v${data.serverVersion} (${data.serverTotal.toLocaleString()} bins). You have v${data.localVersion ?? "–"} (${(data.localCount ?? 0).toLocaleString()} bins).`,
        );
      } else {
        Alert.alert("Up to Date", `Bin content is current (v${data.serverVersion}).`);
      }
    } catch (err) {
      Alert.alert("Check Failed", err.message);
    } finally {
      setBinCheckLoading(false);
    }
  };

  const handleBinSmartSync = async () => {
    setBinDeltaLoading(true);
    setBinProgress({ phase: "checking", percent: 0 });
    try {
      const result = await downloadBinContentDelta((p) => setBinProgress(p));
      const data = await checkBinContentUpdate();
      setBinInfo(data);
      if (result.unchanged) {
        Alert.alert("Already Synced", "No changes since last sync.");
      } else {
        Alert.alert(
          "Smart Sync Done",
          `${result.count.toLocaleString()} bin(s) updated (v${result.version}).`,
        );
      }
    } catch (err) {
      Alert.alert("Sync Failed", err.message);
    } finally {
      setBinDeltaLoading(false);
      setBinProgress(null);
    }
  };

  const handleBinFullDownload = async () => {
    setBinDownloading(true);
    setBinProgress({ phase: "downloading", percent: 0 });
    try {
      const result = await downloadBinContent((p) => setBinProgress(p));
      const data = await checkBinContentUpdate();
      setBinInfo(data);
      Alert.alert(
        "Downloaded",
        `${result.count.toLocaleString()} bin records downloaded (v${result.version}).`,
      );
    } catch (err) {
      Alert.alert("Download Failed", err.message);
    } finally {
      setBinDownloading(false);
      setBinProgress(null);
    }
  };

  const processCSV = async (text) => {
    setImporting(true);
    try {
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const firstRow = parsed.data[0];
      const hasNew =
        firstRow && "Barcode" in firstRow && "Item_Name" in firstRow;
      const hasOld =
        firstRow && "Barcode No." in firstRow && "Item Description" in firstRow;
      if (!firstRow || (!hasNew && !hasOld)) {
        Alert.alert(
          "Invalid CSV",
          "CSV must have headers:\nItemCode, Barcode, Item_Name\nor: Item No., Barcode No., Item Description",
        );
        return;
      }
      const items = parsed.data
        .filter((r) =>
          hasOld
            ? r["Barcode No."] && r["Item Description"]
            : r.Barcode && r.Item_Name,
        )
        .map((r) => ({
          ItemCode: hasOld
            ? r["Item No."] || r["Barcode No."]
            : r.ItemCode || r.Barcode,
          Barcode: String(hasOld ? r["Barcode No."] : r.Barcode).trim(),
          Item_Name: String(
            hasOld ? r["Item Description"] : r.Item_Name,
          ).trim(),
        }));
      if (!items.length) {
        Alert.alert("Empty CSV", "No valid rows found in the file.");
        return;
      }
      await upsertItems(items);
      const stats = await getDashboardStats();
      setLocalCount(stats.totalItems);
      Alert.alert(
        "Imported",
        `${items.length} items updated in local database.`,
      );
    } catch (err) {
      Alert.alert("Import Failed", err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportCSV = async () => {
    if (IS_WEB) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await processCSV(await file.text());
      };
      input.click();
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const content = await FileSystem.readAsStringAsync(picked.assets[0].uri, {
        encoding: "utf8",
      });
      await processCSV(content);
    } catch (err) {
      Alert.alert("Error", err.message);
    }
  };

  const handleClearItems = () => {
    Alert.alert(
      "Clear Local Items",
      "This removes all item master data from THIS phone only.\n\nWorkers cannot scan items until items are re-downloaded from server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Items",
          style: "destructive",
          onPress: async () => {
            try {
              await clearAllItems();
              setLocalCount(0);
              Alert.alert(
                "Cleared",
                "Item master removed from this phone. Re-download from server when ready.",
              );
            } catch (err) {
              Alert.alert("Error", err.message);
            }
          },
        },
      ],
    );
  };

  const versionMatch =
    serverInfo &&
    serverInfo.localVersion != null &&
    String(serverInfo.localVersion) === String(serverInfo.serverVersion);
  const updateAvailable = serverInfo?.updateAvailable;
  const binBusy = binDownloading || binDeltaLoading || binCheckLoading;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {/* Status row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <MaterialCommunityIcons
            name="database"
            size={24}
            color={Colors.primary}
          />
          <Text style={styles.statNum}>{localCount ?? "…"}</Text>
          <Text style={styles.statLabel}>Local Items</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons
            name="cloud-outline"
            size={24}
            color={online ? Colors.success : Colors.textLight}
          />
          <Text style={styles.statNum}>
            {serverInfo
              ? serverInfo.serverCount.toLocaleString()
              : online
                ? "…"
                : "–"}
          </Text>
          <Text style={styles.statLabel}>Server Items</Text>
        </View>
        <View
          style={[
            styles.statCard,
            updateAvailable && { borderColor: "#e65100", borderWidth: 1.5 },
          ]}
        >
          <MaterialCommunityIcons
            name={versionMatch ? "check-circle" : "alert-circle"}
            size={24}
            color={versionMatch ? Colors.success : "#e65100"}
          />
          <Text style={styles.statNum} numberOfLines={1}>
            {serverInfo
              ? `v${serverInfo.localVersion ?? "–"} / v${serverInfo.serverVersion}`
              : "–"}
          </Text>
          <Text style={styles.statLabel}>
            {updateAvailable
              ? "Update Available"
              : versionMatch
                ? "Up to Date"
                : "Version"}
          </Text>
        </View>
      </View>

      {/* Download from server */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Download from Server</Text>
        <Text style={styles.hint}>
          Replaces local item master with the latest server data. Workers can
          scan items immediately after.
        </Text>
        {progress && (
          <>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progress.percent}%` }]}
              />
            </View>
            <Text style={styles.progressText}>
              {progress.phase === "saving"
                ? "Saving to phone…"
                : "Downloading…"}{" "}
              {progress.percent}%
            </Text>
          </>
        )}
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (!online || downloading) && styles.btnDisabled,
          ]}
          onPress={handleDownload}
          disabled={!online || downloading}
        >
          {downloading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <MaterialCommunityIcons
              name="cloud-download"
              size={18}
              color="#fff"
            />
          )}
          <Text style={styles.primaryBtnText}>
            {downloading ? "Downloading…" : "Download Item Master"}
          </Text>
        </TouchableOpacity>
        {!online && (
          <Text style={[styles.hint, { marginTop: 6 }]}>
            ⚠ Not connected to server
          </Text>
        )}
      </View>

      {/* ── Bin Content Data ─────────────────────────────────────────── */}
      <View style={styles.binSection}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <MaterialCommunityIcons name="warehouse" size={22} color="#2e7d32" />
          <Text style={[styles.sectionTitle, { marginBottom: 0, color: "#2e7d32" }]}>
            Bin Content Data
          </Text>
        </View>
        <Text style={styles.hint}>
          Download bin stock data to phone for offline bin suggestions in the
          scanner.
        </Text>
        <View style={styles.binStatRow}>
          <View style={styles.binStat}>
            <Text style={styles.binStatLabel}>Local Count</Text>
            <Text style={styles.binStatNum}>
              {binInfo ? (binInfo.localCount ?? 0).toLocaleString() : "–"}
            </Text>
          </View>
          <View style={styles.binStat}>
            <Text style={styles.binStatLabel}>Local Version</Text>
            <Text style={styles.binStatNum}>
              {binInfo ? `v${binInfo.localVersion ?? "–"}` : "–"}
            </Text>
          </View>
          <View style={styles.binStat}>
            <Text style={styles.binStatLabel}>Server</Text>
            <Text style={styles.binStatNum}>
              {binInfo
                ? `${binInfo.serverTotal.toLocaleString()} (v${binInfo.serverVersion})`
                : "–"}
            </Text>
          </View>
        </View>
        {binProgress && (
          <>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${binProgress.percent}%`, backgroundColor: "#2e7d32" },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {binProgress.phase === "saving"
                ? "Saving to phone…"
                : binProgress.phase === "checking"
                  ? "Checking changes…"
                  : "Downloading…"}{" "}
              {binProgress.percent}%
            </Text>
          </>
        )}
        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            { marginBottom: 8 },
            (!online || binBusy) && styles.btnDisabled,
          ]}
          onPress={handleBinCheckUpdates}
          disabled={!online || binBusy}
        >
          {binCheckLoading ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <MaterialCommunityIcons name="cloud-sync" size={18} color={Colors.primary} />
          )}
          <Text style={styles.secondaryBtnText}>Check Updates</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            { marginBottom: 8 },
            (!online || binBusy) && styles.btnDisabled,
          ]}
          onPress={handleBinSmartSync}
          disabled={!online || binBusy}
        >
          {binDeltaLoading ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <MaterialCommunityIcons name="sync" size={18} color={Colors.primary} />
          )}
          <Text style={styles.secondaryBtnText}>Smart Sync (Changes Only)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.greenBtn, (!online || binBusy) && styles.btnDisabled]}
          onPress={handleBinFullDownload}
          disabled={!online || binBusy}
        >
          {binDownloading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <MaterialCommunityIcons name="cloud-download" size={18} color="#fff" />
          )}
          <Text style={styles.greenBtnText}>
            {binDownloading ? "Downloading…" : "Full Download (All Bins)"}
          </Text>
        </TouchableOpacity>
        {!online && (
          <Text style={[styles.hint, { marginTop: 6 }]}>
            ⚠ Not connected to server
          </Text>
        )}
      </View>

      {/* Import from CSV */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Import from CSV File</Text>
        <Text style={styles.hint}>
          Import items from a local CSV file. Existing barcodes are updated; new
          ones are added. No server connection needed.
        </Text>
        <TouchableOpacity
          style={[styles.secondaryBtn, importing && styles.btnDisabled]}
          onPress={handleImportCSV}
          disabled={importing}
        >
          {importing ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <MaterialCommunityIcons
              name="file-upload-outline"
              size={18}
              color={Colors.primary}
            />
          )}
          <Text style={styles.secondaryBtnText}>
            {importing ? "Importing…" : "Import from CSV"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Danger */}
      <View style={[styles.section, styles.dangerSection]}>
        <Text style={[styles.sectionTitle, { color: Colors.error }]}>
          Danger Zone
        </Text>
        <TouchableOpacity style={styles.dangerBtn} onPress={handleClearItems}>
          <MaterialCommunityIcons
            name="delete-outline"
            size={18}
            color={Colors.error}
          />
          <Text style={styles.dangerBtnText}>Clear Local Items</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statNum: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  section: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dangerSection: {
    borderColor: Colors.error + "40",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 10,
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
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
  },
  secondaryBtnText: { color: Colors.primary, fontWeight: "800", fontSize: 15 },
  btnDisabled: { opacity: 0.6 },
  binSection: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2e7d3240",
  },
  greenBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2e7d32",
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  greenBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  binStatRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  binStat: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2e7d3230",
  },
  binStatLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  binStatNum: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2e7d32",
    textAlign: "center",
  },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.error + "10",
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.error + "40",
  },
  dangerBtnText: { color: Colors.error, fontWeight: "700", fontSize: 14 },
});
