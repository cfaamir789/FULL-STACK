import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
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

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={styles.errBox}>
          <Text style={styles.errTitle}>⚠ Render Error</Text>
          <Text style={styles.errMsg}>
            {String(this.state.error?.message || this.state.error)}
          </Text>
          <Text style={styles.errStack}>
            {String(this.state.error?.stack || "")}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

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
        // On web, expo-sqlite WASM can hang indefinitely — cap it so we
        // don't stay stuck on a blank loading screen forever.
        if (Platform.OS === "web") {
          await withTimeout(initDB(), 6000);
        } else {
          await initDB();
        }
      } catch (e) {
        console.warn("db init error:", e);
      } finally {
        setReady(true);
      }
      tryOtaUpdate().catch(() => {});
    };

    bootstrap();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <AppNavigator />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  loadingText: {
    marginTop: 12,
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  errBox: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#fff5f5",
  },
  errTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#c0392b",
    marginBottom: 12,
  },
  errMsg: {
    fontSize: 14,
    color: "#c0392b",
    marginBottom: 12,
  },
  errStack: {
    fontSize: 11,
    color: "#666",
    fontFamily: "monospace",
  },
});
