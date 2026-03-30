import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, FlatList,
  TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { searchItems, getAllItems } from '../database/db';
import ItemCard from '../components/ItemCard';
import Colors from '../theme/colors';

export default function ItemsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef(null);

  const loadItems = useCallback(async (q = '') => {
    setLoading(true);
    const results = q.trim() ? await searchItems(q.trim()) : await getAllItems();
    setItems(results);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadItems(query);
    }, [loadItems, query])
  );

  const handleQueryChange = (text) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      loadItems(text);
    }, 300);
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or barcode..."
            value={query}
            onChangeText={handleQueryChange}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => navigation.navigate('Import')}
        >
          <MaterialCommunityIcons name="file-import" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>{items.length} items</Text>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="package-variant-closed" size={48} color={Colors.textLight} />
          <Text style={styles.emptyText}>
            {query ? 'No items found' : 'No items yet. Import a CSV to get started.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ItemCard item={item} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          initialNumToRender={20}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.card,
    elevation: 2,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    marginRight: 8,
  },
  searchIcon: { marginRight: 4 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  importBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 10,
  },
  countText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: Colors.textSecondary, textAlign: 'center', marginTop: 12 },
});
