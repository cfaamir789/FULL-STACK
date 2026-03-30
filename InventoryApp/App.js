import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import 'react-native-gesture-handler';
import { initDB } from './src/database/db';
import { startAutoSync } from './src/services/syncService';
import AppNavigator from './src/navigation/AppNavigator';
import Colors from './src/theme/colors';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopSync;
    const bootstrap = async () => {
      await initDB();
      stopSync = startAutoSync(30000);
      setReady(true);
    };

    bootstrap();
    return () => { if (stopSync) stopSync(); };
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
