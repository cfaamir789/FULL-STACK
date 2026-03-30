import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import 'react-native-gesture-handler';
import { initDB, getAllItems } from './src/database/db';
import { startAutoSync } from './src/services/syncService';
import { fetchItems } from './src/services/api';
import { upsertItems } from './src/database/db';
import AppNavigator from './src/navigation/AppNavigator';
import Colors from './src/theme/colors';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopSync;
    const bootstrap = async () => {
      // Initialize SQLite tables
      await initDB();

      // If the device is fresh (no items), try to seed from backend
      try {
        const existing = await getAllItems();
        if (existing.length === 0) {
          const backendItems = await fetchItems();
          if (backendItems && backendItems.length > 0) {
            await upsertItems(
              backendItems.map((i) => ({
                ItemCode: i.ItemCode,
                Barcode: i.Barcode,
                Item_Name: i.Item_Name,
              }))
            );
          }
        }
      } catch {
        // Backend unreachable on first boot is acceptable — user can import CSV
      }

      // Start 30-second auto-sync loop
      stopSync = startAutoSync(30000);
      setReady(true);
    };

    bootstrap();
    return () => {
      if (stopSync) stopSync();
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
