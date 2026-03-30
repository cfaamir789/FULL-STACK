import React, { useState, useCallback } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getRecentTransactions } from '../database/db';
import TransactionRow from '../components/TransactionRow';
import Colors from '../theme/colors';

export default function TransactionsScreen() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {transactions.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="history" size={48} color={Colors.textLight} />
          <Text style={styles.emptyText}>No transactions yet.</Text>
          <Text style={styles.emptySubText}>Scan a barcode on the Scanner tab to create one.</Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <TransactionRow item={item} />}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}
          initialNumToRender={20}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 16, color: Colors.textSecondary, marginTop: 12, fontWeight: '600' },
  emptySubText: { fontSize: 13, color: Colors.textLight, marginTop: 6, textAlign: 'center' },
});
