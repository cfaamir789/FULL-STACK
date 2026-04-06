import React, { useState, useCallback } from 'react';
import {
  View, FlatList, StyleSheet, ActivityIndicator, Text, Alert,
  Modal, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getRecentTransactions, updateTransaction, deleteTransaction } from '../database/db';
import TransactionRow from '../components/TransactionRow';
import Colors from '../theme/colors';

export default function TransactionsScreen({ username, role }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [workerFilter, setWorkerFilter] = useState('all');

  // Get unique worker names for filter chips
  const workerNames = role === 'admin'
    ? [...new Set(transactions.map(tx => tx.worker_name || 'unknown').filter(Boolean))]
    : [];

  const filtered = (() => {
    let result = transactions;
    // Worker filter (admin only)
    if (workerFilter !== 'all') {
      result = result.filter(tx => (tx.worker_name || 'unknown') === workerFilter);
    }
    // Text search
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter((tx) =>
        (tx.item_code && tx.item_code.toLowerCase().includes(q)) ||
        (tx.item_barcode && tx.item_barcode.toLowerCase().includes(q)) ||
        (tx.item_name && tx.item_name.toLowerCase().includes(q)) ||
        (tx.worker_name && tx.worker_name.toLowerCase().includes(q))
      );
    }
    return result;
  })();

  // Edit modal state
  const [editItem, setEditItem] = useState(null);
  const [editFrombin, setEditFrombin] = useState('');
  const [editTobin, setEditTobin] = useState('');
  const [editQty, setEditQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationMsg, setValidationMsg] = useState('');

  // Delete modal state
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    const data = await getRecentTransactions(200);
    setTransactions(data);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTransactions();
    }, [loadTransactions])
  );

  const openEdit = (item) => {
    setEditItem(item);
    setEditFrombin(item.frombin);
    setEditTobin(item.tobin);
    setEditQty(String(item.qty));
  };

  const closeEdit = () => {
    setEditItem(null);
    setEditFrombin('');
    setEditTobin('');
    setEditQty('');
  };

  const handleSave = async () => {
    if (!editFrombin.trim() || !editTobin.trim() || !editQty.trim()) {
      setValidationMsg('All fields are required.');
      return;
    }
    const qty = parseInt(editQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setValidationMsg('Qty must be a positive number.');
      return;
    }
    setValidationMsg('');
    setSaving(true);
    try {
      await updateTransaction(editItem.id, { frombin: editFrombin, tobin: editTobin, qty }, username, role);
      await loadTransactions();
      closeEdit();
    } catch (err) {
      setValidationMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (item) => {
    setDeleteItem(item);
    setDeleteConfirmed(false);
  };

  const closeDelete = () => {
    setDeleteItem(null);
    setDeleteConfirmed(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirmed) return;
    setDeleting(true);
    try {
      await deleteTransaction(deleteItem.id, username, role);
      await loadTransactions();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setDeleting(false);
      closeDelete();
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={20} color={Colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by item code, barcode or name..."
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={18} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      </View>

      {/* Worker filter chips (admin only) */}
      {role === 'admin' && workerNames.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.workerFilterBar} contentContainerStyle={styles.workerFilterContent}>
          <TouchableOpacity
            style={[styles.workerChip, workerFilter === 'all' && styles.workerChipActive]}
            onPress={() => setWorkerFilter('all')}
          >
            <Text style={[styles.workerChipText, workerFilter === 'all' && styles.workerChipTextActive]}>All Workers</Text>
          </TouchableOpacity>
          {workerNames.map(name => (
            <TouchableOpacity
              key={name}
              style={[styles.workerChip, workerFilter === name && styles.workerChipActive]}
              onPress={() => setWorkerFilter(workerFilter === name ? 'all' : name)}
            >
              <MaterialCommunityIcons name="account" size={14} color={workerFilter === name ? '#fff' : Colors.textSecondary} />
              <Text style={[styles.workerChipText, workerFilter === name && styles.workerChipTextActive]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {transactions.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="history" size={48} color={Colors.textLight} />
          <Text style={styles.emptyText}>No transactions yet.</Text>
          <Text style={styles.emptySubText}>Scan a barcode on the Scanner tab to create one.</Text>
        </View>
      ) : (
        <>
          <View style={styles.countBar}>
            <Text style={styles.countText}>
              {query.trim()
                ? `${filtered.length} of ${transactions.length} transactions`
                : `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="magnify-close" size={40} color={Colors.textLight} />
              <Text style={styles.emptyText}>No matches found</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <TransactionRow
                  item={item}
                  onEdit={openEdit}
                  onDelete={openDelete}
                  canEdit={role === 'admin' || item.worker_name === username}
                  canDelete={role === 'admin' || item.worker_name === username}
                />
              )}
              contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}
              initialNumToRender={20}
              removeClippedSubviews
            />
          )}
        </>
      )}

      {/* ── Edit Modal ── */}
      <Modal visible={!!editItem} transparent animationType="slide" onRequestClose={closeEdit}>
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { justifyContent: 'flex-end' }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Transaction</Text>
              <TouchableOpacity onPress={closeEdit}>
                <MaterialCommunityIcons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Read-only item info */}
              {editItem?.item_code && editItem.item_code.trim() !== '' ? (
                <View style={styles.readonlyBox}>
                  <MaterialCommunityIcons name="identifier" size={16} color={Colors.textSecondary} />
                  <Text style={styles.readonlyText}>Item Code: {editItem.item_code}</Text>
                </View>
              ) : null}
              <View style={[styles.readonlyBox, { marginTop: 4 }]}>
                <MaterialCommunityIcons name="package-variant" size={16} color={Colors.textSecondary} />
                <Text style={styles.readonlyText} numberOfLines={2}>
                  {editItem?.item_name}
                </Text>
              </View>
              <View style={[styles.readonlyBox, { marginTop: 4 }]}>
                <MaterialCommunityIcons name="barcode" size={16} color={Colors.textSecondary} />
                <Text style={styles.readonlyText}>{editItem?.item_barcode}</Text>
              </View>

              <Text style={styles.label}>From Bin</Text>
              <TextInput
                style={styles.input}
                value={editFrombin}
                onChangeText={setEditFrombin}
                autoCapitalize="characters"
                placeholder="e.g. A001"
              />

              <Text style={styles.label}>To Bin</Text>
              <TextInput
                style={styles.input}
                value={editTobin}
                onChangeText={setEditTobin}
                autoCapitalize="characters"
                placeholder="e.g. B002"
              />

              <Text style={styles.label}>Quantity</Text>
              <TextInput
                style={styles.input}
                value={editQty}
                onChangeText={setEditQty}
                keyboardType="numeric"
                placeholder="e.g. 10"
              />

              {validationMsg !== '' && (
                <Text style={styles.validationMsg}>{validationMsg}</Text>
              )}
            </ScrollView>

            {/* Buttons */}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeEdit}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>Save Changes</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal visible={!!deleteItem} transparent animationType="fade" onRequestClose={closeDelete}>
        <View style={styles.modalOverlay}>
          <View style={styles.deleteCard}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color={Colors.error} />
              <Text style={[styles.modalTitle, { color: Colors.error, marginLeft: 8 }]}>Delete Transaction</Text>
              <TouchableOpacity onPress={closeDelete} style={{ marginLeft: 'auto' }}>
                <MaterialCommunityIcons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.deleteQuestion}>Are you sure you want to delete this transaction?</Text>

            {/* Item info */}
            <View style={styles.deleteInfoBox}>
              <Text style={styles.deleteInfoCode}>{deleteItem?.item_code}</Text>
              <Text style={styles.deleteInfoName} numberOfLines={2}>{deleteItem?.item_name}</Text>
              <Text style={styles.deleteInfoMeta}>
                {deleteItem?.frombin} → {deleteItem?.tobin}  •  Qty: {deleteItem?.qty}
              </Text>
            </View>

            {/* Checkbox confirmation */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setDeleteConfirmed(!deleteConfirmed)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, deleteConfirmed && styles.checkboxChecked]}>
                {deleteConfirmed && (
                  <MaterialCommunityIcons name="check" size={14} color="#fff" />
                )}
              </View>
              <Text style={styles.checkboxLabel}>I confirm I want to permanently delete this record</Text>
            </TouchableOpacity>

            {/* Buttons */}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeDelete}>
                <Text style={styles.cancelBtnText}>No, Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteBtn, (!deleteConfirmed || deleting) && styles.deleteBtnDisabled]}
                onPress={handleDelete}
                disabled={!deleteConfirmed || deleting}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.deleteBtnText}>Yes, Delete</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
    color: Colors.textPrimary,
  },
  workerFilterBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    maxHeight: 48,
  },
  workerFilterContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  workerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  workerChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  workerChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  workerChipTextActive: {
    color: '#fff',
  },
  countBar: {
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  countText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 16, color: Colors.textSecondary, marginTop: 12, fontWeight: '600' },
  emptySubText: { fontSize: 13, color: Colors.textLight, marginTop: 6, textAlign: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' },
  modalCard: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  readonlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 4,
    gap: 8,
  },
  readonlyText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, marginTop: 14, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: Colors.background,
    color: Colors.textPrimary,
  },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, color: Colors.textSecondary, fontWeight: '600' },
  saveBtn: {
    flex: 2, backgroundColor: Colors.primary,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  validationMsg: { fontSize: 13, color: Colors.error, marginTop: 10, textAlign: 'center' },

  // Delete Modal
  deleteCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  deleteQuestion: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 12,
  },
  deleteInfoBox: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  deleteInfoCode: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginBottom: 2 },
  deleteInfoName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  deleteInfoMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: { backgroundColor: Colors.error, borderColor: Colors.error },
  checkboxLabel: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  deleteBtn: {
    flex: 2, backgroundColor: Colors.error,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
