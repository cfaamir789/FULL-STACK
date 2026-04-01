import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '../theme/colors';

export default function ItemCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const count = item.barcodes ? item.barcodes.length : 1;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="package-variant" size={22} color={Colors.primary} />
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{item.item_name}</Text>
          <Text style={styles.sub}>Item Code: {item.item_code}</Text>
          <Text style={styles.sub}>
            {count} barcode{count !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.viewBtn, expanded && styles.viewBtnActive]}
          onPress={() => setExpanded(!expanded)}
        >
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'barcode'}
            size={16}
            color={expanded ? Colors.primary : Colors.primary}
          />
          <Text style={styles.viewBtnText}>{expanded ? 'Hide' : 'View'}</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={styles.barcodeList}>
          <Text style={styles.barcodeHeader}>All Barcodes ({count})</Text>
          {item.barcodes.map((b, idx) => (
            <View key={b} style={styles.barcodeRow}>
              <MaterialCommunityIcons name="barcode" size={14} color={Colors.textLight} />
              <Text style={styles.barcodeText}>{b}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
    marginLeft: 8,
  },
  viewBtnActive: { backgroundColor: Colors.primary + '15' },
  viewBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  barcodeList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  barcodeHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  barcodeText: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontFamily: 'monospace',
  },
});
