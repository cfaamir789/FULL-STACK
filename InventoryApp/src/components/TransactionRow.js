import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '../theme/colors';

export default function TransactionRow({ item, onEdit, onDelete }) {
  const synced = item.synced === 1;
  const date = new Date(item.timestamp);
  const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        {item.item_code && item.item_code.trim() !== '' ? (
          <Text style={styles.itemCode}>Item Code: {item.item_code}</Text>
        ) : null}
        <Text style={styles.itemName} numberOfLines={1}>
          {item.item_name}
        </Text>
        <Text style={styles.barcode}>{item.item_barcode}</Text>
        <Text style={styles.meta}>
          {item.frombin} → {item.tobin}  •  Qty: {item.qty}
        </Text>
        <Text style={styles.time}>{timeStr}</Text>
      </View>

      <View style={styles.right}>
        {!!onEdit && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => onEdit(item)}>
              <MaterialCommunityIcons name="pencil-outline" size={18} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => onDelete && onDelete(item)}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color={Colors.error} />
            </TouchableOpacity>
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: synced ? Colors.success + '20' : Colors.pending + '20' }]}>
          <MaterialCommunityIcons
            name={synced ? 'check-circle' : 'clock-outline'}
            size={16}
            color={synced ? Colors.success : Colors.pending}
          />
          <Text style={[styles.badgeText, { color: synced ? Colors.success : Colors.pending }]}>
            {synced ? 'Synced' : 'Pending'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  info: { flex: 1, marginRight: 8 },
  itemCode: { fontSize: 11, fontWeight: '700', color: Colors.primary, marginBottom: 1 },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  barcode: { fontSize: 11, color: Colors.textLight, marginTop: 1, fontFamily: 'monospace' },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 3 },
  time: { fontSize: 11, color: Colors.textLight, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 6 },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: Colors.background,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', marginLeft: 3 },
});
