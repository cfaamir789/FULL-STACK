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
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  getDashboardStats,
  getAllTransactions,
  getPendingTransactions,
} from "../database/db";
import { getDisplayUrl, getServerTransactions } from "../services/api";
import {
  attemptSync,
  setSyncStatusListener,
  setDataClearedListener,
} from "../services/syncService";
import StatsCard from "../components/StatsCard";
import SyncStatusBanner from "../components/SyncStatusBanner";
import TransactionRow from "../components/TransactionRow";
import VoiceMic from "../components/VoiceMic";
import Colors from "../theme/colors";
import {
  isTransactionOwnedByUser,
  mapServerTransactionToLocalShape,
  mergeTransactions,
} from "../utils/transactions";

export default function DashboardScreen({ username }) {
  const queryRef = useRef(null);
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

  const loadData = useCallback(async () => {
    const [localStats, localAll, localPendingAll] = await Promise.all([
      getDashboardStats(),
      getAllTransactions(),
      getPendingTransactions(),
    ]);
    const localRecent = localAll.filter((tx) =>
      isTransactionOwnedByUser(tx, username),
    );
    const localPending = localPendingAll.filter((tx) =>
      isTransactionOwnedByUser(tx, username),
    );

    let nextStats = {
      totalItems: localStats.totalItems,
      totalTransactions: localRecent.length,
      pendingSync: localPending.length,
    };
    let nextRecent = localRecent;

    try {
      const serverRes = await getServerTransactions(1, 200, "all", {
        mine: true,
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
      loadData();
    }, [loadData]),
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
          <VoiceMic
            onResult={(t) => setQuery(t.toUpperCase())}
            focusTargetRef={queryRef}
            size={18}
            style={{ backgroundColor: "transparent", marginRight: 2 }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={Colors.textLight}
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
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
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
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 16,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 16,
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
});
