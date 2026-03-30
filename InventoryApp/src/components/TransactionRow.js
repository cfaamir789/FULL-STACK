import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '../theme/colors';

export default function TransactionRow({ item }) {
  const synced = item.synced === 1;
  const date = new Date(item.timestamp);
  const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.item_name}
        </Text>
        <Text style={styles.meta}>
          {item.frombin} → {item.tobin}  •  Qty: {item.qty}
        </Text>
        <Text style={styles.time}>{timeStr}</Text>
      </View>
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
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  time: { fontSize: 11, color: Colors.textLight, marginTop: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', marginLeft: 3 },
});
