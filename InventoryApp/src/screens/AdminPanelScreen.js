import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, RefreshControl, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getTransactionStats, getExportUrl, checkHealth,
  clearServerTransactions, clearServerItems,
} from '../services/api';
import { getDashboardStats, clearAllTransactions, clearAllItems, getPendingCount } from '../database/db';
import { attemptSync } from '../services/syncService';
import Colors from '../theme/colors';

const IS_WEB = Platform.OS === 'web';
let Sharing = null;
let FileSystem = null;
if (!IS_WEB) {
  Sharing = require('expo-sharing');
  FileSystem = require('expo-file-system');
}

export default function AdminPanelScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(false);
  const [localStats, setLocalStats] = useState({ totalItems: 0, totalTransactions: 0, pendingSync: 0 });
  const [serverStats, setServerStats] = useState({ total: 0, workers: [] });
  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadData = useCallback(async () => {
    const local = await getDashboardStats();
    setLocalStats(local);

    try {
      await checkHealth();
      setOnline(true);
      const stats = await getTransactionStats();
      setServerStats(stats);
    } catch {
      setOnline(false);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadData();
  }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleExportAll = async () => {
    if (!online) {
      Alert.alert('Offline', 'Connect to server to export transactions.');
      return;
    }
    setExporting(true);
    try {
      const token = await AsyncStorage.getItem('authToken');
      const url = `${getExportUrl()}?token=${encodeURIComponent(token)}`;

      if (IS_WEB) {
        window.open(url, '_blank');
      } else {
        const fileUri = FileSystem.documentDirectory + 'transactions_export.csv';
        const download = await FileSystem.downloadAsync(url, fileUri, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(download.uri, { mimeType: 'text/csv', dialogTitle: 'Export Transactions' });
        } else {
          Alert.alert('Exported', `File saved to ${download.uri}`);
        }
      }
    } catch (err) {
      Alert.alert('Export Failed', err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportWorker = async (workerName) => {
    if (!online) {
      Alert.alert('Offline', 'Connect to server to export transactions.');
      return;
    }
    try {
      const token = await AsyncStorage.getItem('authToken');
      const url = `${getExportUrl()}?worker=${encodeURIComponent(workerName)}&token=${encodeURIComponent(token)}`;

      if (IS_WEB) {
        window.open(url, '_blank');
      } else {
        const safeWorker = workerName.replace(/[^a-zA-Z0-9]/g, '_');
        const fileUri = FileSystem.documentDirectory + `transactions_${safeWorker}.csv`;
        const download = await FileSystem.downloadAsync(url, fileUri, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(download.uri, { mimeType: 'text/csv', dialogTitle: `${workerName}'s Transactions` });
        } else {
          Alert.alert('Exported', `File saved to ${download.uri}`);
        }
      }
    } catch (err) {
      Alert.alert('Export Failed', err.message);
    }
  };

  // ─── End of Day: Sync → Export → Clear ───────────────────────────────────
  const handleEndOfDay = () => {
    if (!online) {
      Alert.alert('Offline', 'You must be connected to the server for End of Day.');
      return;
    }
    Alert.alert(
      'End of Day Reset',
      'This will:\n\n' +
      '1. Sync all pending transactions to server\n' +
      '2. Clear all transactions from THIS phone\n' +
      '3. Clear all transactions from the server\n\n' +
      'Make sure you have EXPORTED the data first!\n\n' +
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I Already Exported — Clear All',
          style: 'destructive',
          onPress: doEndOfDay,
        },
      ]
    );
  };

  const doEndOfDay = async () => {
    setResetting(true);
    try {
      // Step 1: sync any remaining pending transactions
      const pending = await getPendingCount();
      if (pending > 0) {
        await attemptSync();
      }

      // Step 2: clear local transactions (phone SQLite)
      const localCleared = await clearAllTransactions();

      // Step 3: clear server transactions
      let serverCleared = 0;
      try {
        const result = await clearServerTransactions();
        serverCleared = result.deleted || 0;
      } catch (err) {
        Alert.alert('Warning', `Phone cleared, but server clear failed: ${err.message}`);
      }

      await loadData();
      Alert.alert(
        'End of Day Complete',
        `Cleared ${localCleared} local + ${serverCleared} server transactions.\n\nPhones will start fresh on next use.`
      );
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setResetting(false);
    }
  };

  // ─── Clear phone data only ──────────────────────────────────────────────
  const handleClearPhoneData = () => {
    Alert.alert(
      'Clear Phone Data',
      'This will delete all items and synced transactions from THIS phone only.\n\nPending (un-synced) transactions will be LOST.\n\nItems will be re-downloaded on next sync.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Phone Data',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllItems();
              await clearAllTransactions();
              await loadData();
              Alert.alert('Done', 'Phone data cleared. Items will re-download on next sync.');
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Connection Banner */}
        <View style={[styles.connBanner, { backgroundColor: online ? Colors.success + '15' : Colors.error + '15' }]}>
          <MaterialCommunityIcons
            name={online ? 'server-network' : 'server-network-off'}
            size={18}
            color={online ? Colors.success : Colors.error}
          />
          <Text style={[styles.connText, { color: online ? Colors.success : Colors.error }]}>
            {online ? 'Server Connected' : 'Server Offline — showing local data only'}
          </Text>
        </View>

        {/* Overview Stats */}
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="package-variant" size={28} color={Colors.primary} />
            <Text style={styles.statValue}>{localStats.totalItems}</Text>
            <Text style={styles.statLabel}>Total Items</Text>
          </View>
          <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('AdminTransactions')}>
            <MaterialCommunityIcons name="swap-horizontal" size={28} color={Colors.success} />
            <Text style={styles.statValue}>{online ? serverStats.total : localStats.totalTransactions}</Text>
            <Text style={styles.statLabel}>All Transactions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('AdminUsers')}>
            <MaterialCommunityIcons name="account-group" size={28} color={Colors.primaryLight} />
            <Text style={styles.statValue}>{online ? serverStats.workers.length : '-'}</Text>
            <Text style={styles.statLabel}>Workers</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Admin Actions</Text>
        <View style={styles.actionsGrid}>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('AdminUsers')}>
            <View style={[styles.actionIcon, { backgroundColor: Colors.primary + '15' }]}>
              <MaterialCommunityIcons name="account-cog" size={24} color={Colors.primary} />
            </View>
            <Text style={styles.actionTitle}>Manage Users</Text>
            <Text style={styles.actionSub}>Add / remove workers</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('Import')}>
            <View style={[styles.actionIcon, { backgroundColor: Colors.success + '15' }]}>
              <MaterialCommunityIcons name="file-upload" size={24} color={Colors.success} />
            </View>
            <Text style={styles.actionTitle}>Import Items CSV</Text>
            <Text style={styles.actionSub}>Upload item master file</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={handleExportAll}
            disabled={exporting}
          >
            <View style={[styles.actionIcon, { backgroundColor: Colors.warning + '15' }]}>
              {exporting
                ? <ActivityIndicator size="small" color={Colors.warning} />
                : <MaterialCommunityIcons name="file-download" size={24} color={Colors.warning} />}
            </View>
            <Text style={styles.actionTitle}>Export All Data</Text>
            <Text style={styles.actionSub}>Download transactions CSV</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('AdminTransactions')}>
            <View style={[styles.actionIcon, { backgroundColor: '#9C27B0' + '15' }]}>
              <MaterialCommunityIcons name="history" size={24} color="#9C27B0" />
            </View>
            <Text style={styles.actionTitle}>All Transactions</Text>
            <Text style={styles.actionSub}>View & filter all work</Text>
          </TouchableOpacity>
        </View>

        {/* End of Day Section */}
        <Text style={styles.sectionTitle}>End of Day</Text>
        <View style={styles.eodCard}>
          <Text style={styles.eodDesc}>
            After exporting all data, use this to clear transactions from the server and all phones.
            Workers' phones will be cleaned on next sync.
          </Text>
          <View style={styles.eodSteps}>
            <Text style={styles.eodStep}>1. Export all data (button above)</Text>
            <Text style={styles.eodStep}>2. Press "End of Day Reset" below</Text>
            <Text style={styles.eodStep}>3. Optionally upload new item master CSV</Text>
          </View>
          <TouchableOpacity
            style={[styles.eodBtn, resetting && styles.eodBtnDisabled]}
            onPress={handleEndOfDay}
            disabled={resetting}
          >
            {resetting
              ? <ActivityIndicator size="small" color="#fff" />
              : <MaterialCommunityIcons name="broom" size={20} color="#fff" />}
            <Text style={styles.eodBtnText}>{resetting ? 'Clearing...' : 'End of Day Reset'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearPhoneBtn} onPress={handleClearPhoneData}>
            <MaterialCommunityIcons name="cellphone-erase" size={16} color={Colors.error} />
            <Text style={styles.clearPhoneBtnText}>Clear This Phone Only</Text>
          </TouchableOpacity>
        </View>

        {/* Worker Activity */}
        {online && serverStats.workers.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Worker Activity</Text>
            {serverStats.workers.map((w) => (
              <View key={w.worker} style={styles.workerRow}>
                <View style={styles.workerAvatar}>
                  <MaterialCommunityIcons name="account-hard-hat" size={22} color={Colors.primary} />
                </View>
                <View style={styles.workerInfo}>
                  <Text style={styles.workerName}>{w.worker}</Text>
                  <Text style={styles.workerSub}>
                    {w.count} transaction{w.count !== 1 ? 's' : ''}
                    {w.lastTransaction ? '  •  Last: ' + new Date(w.lastTransaction).toLocaleDateString() : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={() => handleExportWorker(w.worker)}
                >
                  <MaterialCommunityIcons name="download" size={18} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {!online && (
          <View style={styles.offlineHint}>
            <MaterialCommunityIcons name="information-outline" size={18} color={Colors.textSecondary} />
            <Text style={styles.offlineHintText}>
              Connect to the server to see worker stats and export data.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  connBanner: {
    flexDirection: 'row', alignItems: 'center', padding: 10,
    borderRadius: 8, marginBottom: 16, gap: 8,
  },
  connText: { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 10, marginTop: 8 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    alignItems: 'center', elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginTop: 6 },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  actionCard: {
    width: '48%', backgroundColor: Colors.card, borderRadius: 12, padding: 16,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, flexGrow: 1, flexBasis: '46%',
  },
  actionIcon: {
    width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  actionTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  actionSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  workerRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    borderRadius: 10, padding: 12, marginBottom: 8, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2,
  },
  workerAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary + '12',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  workerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  downloadBtn: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.primary + '10',
    justifyContent: 'center', alignItems: 'center',
  },
  offlineHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    padding: 12, backgroundColor: Colors.card, borderRadius: 8,
  },
  offlineHintText: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  eodCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1.5, borderColor: Colors.error + '30',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4,
  },
  eodDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  eodSteps: { marginBottom: 14, paddingLeft: 4 },
  eodStep: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500', lineHeight: 22 },
  eodBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.error, borderRadius: 10, paddingVertical: 14,
  },
  eodBtnDisabled: { backgroundColor: Colors.textLight },
  eodBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  clearPhoneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 10, paddingVertical: 10,
  },
  clearPhoneBtnText: { color: Colors.error, fontSize: 13, fontWeight: '600' },
});
