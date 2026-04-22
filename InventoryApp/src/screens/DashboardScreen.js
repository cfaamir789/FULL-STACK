import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  getDashboardStats,
  getPendingTransactions,
  getTransactionsPage,
} from "../database/db";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDisplayUrl, getServerTransactions } from "../services/api";
import {
  attemptSync,
  setSyncStatusListener,
  setDataClearedListener,
} from "../services/syncService";
import StatsCard from "../components/StatsCard";
import SyncStatusBanner from "../components/SyncStatusBanner";
import TransactionRow from "../components/TransactionRow";
import Colors from "../theme/colors";
import {
  isTransactionOwnedByUser,
  mapServerTransactionToLocalShape,
  mergeTransactions,
} from "../utils/transactions";

const IS_WEB = Platform.OS === "web";
let CameraView, useCameraPermissions;
if (!IS_WEB) {
  try {
    const cam = require("expo-camera");
    CameraView = cam.CameraView;
    useCameraPermissions = cam.useCameraPermissions;
  } catch {
    CameraView = null;
    useCameraPermissions = () => [{ granted: false }, async () => {}];
  }
} else {
  useCameraPermissions = () => [{ granted: false }, async () => {}];
}

export default function DashboardScreen({ username }) {
  const queryRef = useRef(null);
  const lastLoadedAtRef = useRef(0);
  const [stats, setStats] = useState({
    totalItems: 0,
    totalTransactions: 0,
    pendingSync: 0,
  });
  const [recent, setRecent] = useState([]);
  const [syncStatus, setSyncStatus] = useState({
    online: null,
    lastSync: null,
    pendingCount: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const openScanner = async () => {
    if (IS_WEB) return;
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) return;
    }
    setShowScanner(true);
  };

  const handleBarCodeScanned = ({ data }) => {
    setShowScanner(false);
    setQuery(data.trim().toUpperCase());
    setTimeout(() => queryRef.current?.focus(), 100);
  };

  const loadData = useCallback(async () => {
    const [localStats, localRecent, localPending] = await Promise.all([
      getDashboardStats(),
      getTransactionsPage(50, 0, username),
      getPendingTransactions(username),
    ]);

    let nextStats = {
      totalItems: localStats.totalItems,
      totalTransactions: localRecent.length,
      pendingSync: localPending.length,
    };
    let nextRecent = localRecent;

    try {
      const phoneClearedAt = await AsyncStorage.getItem("phoneClearedAt");
      const serverRes = await getServerTransactions(1, 200, "all", {
        mine: true,
        ...(phoneClearedAt ? { after: phoneClearedAt } : {}),
      });
      const serverRecent = (serverRes.transactions || []).map(
        mapServerTransactionToLocalShape,
      );
      nextStats = {
        totalItems: localStats.totalItems,
        totalTransactions: Number(serverRes.total || 0),
        pendingSync: localPending.length,
      };
      nextRecent = mergeTransactions(serverRecent, localPending);
    } catch (_) {
      // Server unavailable — keep local fallback so the app still works offline.
    }

    setStats(nextStats);
    setRecent(nextRecent);
    lastLoadedAtRef.current = Date.now();
  }, [username]);

  const filtered = useMemo(
    () =>
      query.trim()
        ? recent.filter((tx) => {
            const q = query.trim().toLowerCase();
            return (
              (tx.item_code && tx.item_code.toLowerCase().includes(q)) ||
              (tx.item_barcode && tx.item_barcode.toLowerCase().includes(q)) ||
              (tx.item_name && tx.item_name.toLowerCase().includes(q))
            );
          })
        : showAllRecent
          ? recent
          : recent.slice(0, 5),
    [recent, query, showAllRecent],
  );

  useFocusEffect(
    useCallback(() => {
      if (recent.length === 0 || Date.now() - lastLoadedAtRef.current > 15000) {
        loadData();
      }
      // Clear search query when user leaves this tab
      return () => {
        setQuery("");
      };
    }, [loadData, recent.length]),
  );

  useEffect(() => {
    const unsub = setSyncStatusListener((status) => {
      setSyncStatus(status);
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = setDataClearedListener(() => loadData());
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [loadData]);

  const handleSyncNow = async () => {
    setSyncing(true);
    await attemptSync();
    await loadData();
    setSyncing(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Barcode scanner overlay */}
      {showScanner && !IS_WEB && CameraView && (
        <View style={styles.scannerOverlay}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{
              barcodeTypes: [
                "ean13",
                "ean8",
                "code128",
                "code39",
                "upc_a",
                "qr",
              ],
            }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <TouchableOpacity
            style={styles.scannerCloseBtn}
            onPress={() => setShowScanner(false)}
          >
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.scannerHint}>Scan a barcode to search</Text>
        </View>
      )}
      <SyncStatusBanner
        online={syncStatus.online}
        lastSync={syncStatus.lastSync}
        pendingCount={stats.pendingSync}
        serverLabel={getDisplayUrl()}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsRow}>
          <StatsCard
            icon="package-variant"
            label="Total Items"
            value={stats.totalItems}
            color={Colors.primary}
          />
          <StatsCard
            icon="swap-horizontal"
            label="History"
            value={stats.totalTransactions}
            color={Colors.success}
          />
          <StatsCard
            icon="cloud-sync"
            label="Pending Sync"
            value={stats.pendingSync}
            color={stats.pendingSync > 0 ? Colors.pending : Colors.success}
          />
        </View>

        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          onPress={handleSyncNow}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <MaterialCommunityIcons name="sync" size={20} color="#fff" />
          )}
          <Text style={styles.syncBtnText}>
            {syncing ? "Syncing..." : "Sync Now"}
          </Text>
        </TouchableOpacity>

        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={Colors.textSecondary}
              style={{ marginRight: 8 }}
            />
            <TextInput
              ref={queryRef}
              style={styles.searchInput}
              placeholder="Search by item code, barcode or name..."
              value={query}
              onChangeText={(t) => setQuery(t.toUpperCase())}
              autoCapitalize="characters"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setQuery("");
                  queryRef.current?.focus();
                }}
                style={{ padding: 4 }}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={18}
                  color={Colors.textLight}
                />
              </TouchableOpacity>
            )}
          </View>
          {!IS_WEB && (
            <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
              <MaterialCommunityIcons
                name="barcode-scan"
                size={20}
                color="#fff"
              />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionTitle}>
          {query.trim()
            ? `${filtered.length} result${filtered.length !== 1 ? "s" : ""}`
            : "Recent Transactions"}
        </Text>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name={query.trim() ? "magnify-close" : "history"}
              size={40}
              color={Colors.textLight}
            />
            <Text style={styles.emptyText}>
              {query.trim() ? "No matches found" : "No transactions yet"}
            </Text>
          </View>
        ) : (
          filtered.map((tx) => <TransactionRow key={tx.id} item={tx} />)
        )}
        {!query.trim() && recent.length > 5 && (
          <TouchableOpacity
            style={styles.expandBtn}
            onPress={() => setShowAllRecent((v) => !v)}
          >
            <MaterialCommunityIcons
              name={showAllRecent ? "chevron-up" : "chevron-down"}
              size={18}
              color={Colors.primary}
            />
            <Text style={styles.expandBtnText}>
              {showAllRecent
                ? "Collapse"
                : `Show All ${recent.length} Transactions`}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 24 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 12,
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 10,
    elevation: 2,
  },
  syncBtnDisabled: { backgroundColor: Colors.textLight },
  syncBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    marginLeft: 8,
  },
  empty: { alignItems: "center", paddingVertical: 32 },
  emptyText: { color: Colors.textLight, marginTop: 8 },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  expandBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 10,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    paddingVertical: 2,
  },
  scanBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    padding: 10,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: "#000",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 40,
  },
  scannerCloseBtn: {
    position: "absolute",
    top: 48,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 24,
    padding: 8,
  },
  scannerHint: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
});
