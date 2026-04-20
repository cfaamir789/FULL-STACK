import React, { useEffect, useState } from "react";
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Platform,
  LogBox,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import "react-native-gesture-handler";
import { initDB } from "./src/database/db";
import AppNavigator from "./src/navigation/AppNavigator";
import Colors from "./src/theme/colors";

LogBox.ignoreLogs(["ota update", "expo-updates"]);

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);

const tryOtaUpdate = async () => {
  if (Platform.OS === "web" || __DEV__) return;
  try {
    const Updates = require("expo-updates");
    if (!Updates.isEnabled) return;
    const update = await withTimeout(Updates.checkForUpdateAsync(), 5000);
    if (update.isAvailable) {
      await withTimeout(Updates.fetchUpdateAsync(), 15000);
      await Updates.reloadAsync();
    }
  } catch (e) {
    console.warn("ota update check skipped:", e);
  }
};

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await initDB();
      } catch (e) {
        console.warn("db init error:", e);
      } finally {
        setReady(true);
      }
      // Fire OTA check in background AFTER app is ready
      tryOtaUpdate().catch(() => {});
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
