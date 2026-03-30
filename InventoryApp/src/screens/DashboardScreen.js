import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getDashboardStats, getRecentTransactions } from '../database/db';
import { attemptSync, setSyncStatusListener } from '../services/syncService';
import StatsCard from '../components/StatsCard';
import SyncStatusBanner from '../components/SyncStatusBanner';
import TransactionRow from '../components/TransactionRow';
import Colors from '../theme/colors';

export default function DashboardScreen() {
  const [stats, setStats] = useState({ totalItems: 0, totalTransactions: 0, pendingSync: 0 });
  const [recent, setRecent] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ online: null, lastSync: null, pendingCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [s, r] = await Promise.all([getDashboardStats(), getRecentTransactions(5)]);
    setStats(s);
    setRecent(r);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
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
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsRow}>
          <StatsCard icon="package-variant" label="Total Items" value={stats.totalItems} color={Colors.primary} />
          <StatsCard icon="swap-horizontal" label="Transactions" value={stats.totalTransactions} color={Colors.success} />
          <StatsCard icon="cloud-sync" label="Pending Sync" value={stats.pendingSync} color={stats.pendingSync > 0 ? Colors.pending : Colors.success} />
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
          <Text style={styles.syncBtnText}>{syncing ? 'Syncing...' : 'Sync Now'}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        {recent.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="history" size={40} color={Colors.textLight} />
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        ) : (
          recent.map((tx) => <TransactionRow key={tx.id} item={tx} />)
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
    fontWeight: '700',
    color: Colors.textPrimary,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 16,
    elevation: 2,
  },
  syncBtnDisabled: { backgroundColor: Colors.textLight },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { color: Colors.textLight, marginTop: 8 },
});
