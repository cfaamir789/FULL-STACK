import React, { useEffect, useState, useCallback, useRef } from "react";
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
import { getDashboardStats, getRecentTransactions } from "../database/db";
import { getDisplayUrl } from "../services/api";
import { attemptSync, setSyncStatusListener } from "../services/syncService";
import StatsCard from "../components/StatsCard";
import SyncStatusBanner from "../components/SyncStatusBanner";
import TransactionRow from "../components/TransactionRow";
import VoiceMic from "../components/VoiceMic";
import Colors from "../theme/colors";

export default function DashboardScreen() {
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

  const loadData = useCallback(async () => {
    const [s, r] = await Promise.all([
      getDashboardStats(),
      getRecentTransactions(200),
    ]);
    setStats(s);
    setRecent(r);
  }, []);

  const filtered = query.trim()
    ? recent.filter((tx) => {
        const q = query.trim().toLowerCase();
        return (
          (tx.item_code && tx.item_code.toLowerCase().includes(q)) ||
          (tx.item_barcode && tx.item_barcode.toLowerCase().includes(q)) ||
          (tx.item_name && tx.item_name.toLowerCase().includes(q))
        );
      })
    : recent.slice(0, 5);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  useEffect(() => {
    setSyncStatusListener((status) => {
      setSyncStatus(status);
    });
  }, []);

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
            label="Transactions"
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
