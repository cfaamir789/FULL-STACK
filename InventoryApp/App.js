import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import "react-native-gesture-handler";
import * as Updates from "expo-updates";
import { initDB } from "./src/database/db";
import AppNavigator from "./src/navigation/AppNavigator";
import Colors from "./src/theme/colors";

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const applyOtaUpdateIfAvailable = async () => {
      if (Platform.OS === "web" || __DEV__ || !Updates.isEnabled) {
        return;
      }

      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (e) {
        console.warn("ota update check failed:", e);
      }
    };

    const bootstrap = async () => {
      try {
        await applyOtaUpdateIfAvailable();
        await initDB();
      } catch (e) {
        console.warn("bootstrap error:", e);
      } finally {
        setReady(true);
      }
    };

    bootstrap();
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
});
