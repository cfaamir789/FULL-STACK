import React, { useState, useEffect } from "react";
import {
  InteractionManager,
  TouchableOpacity,
  View,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider } from "react-native-safe-area-context";

import DashboardScreen from "../screens/DashboardScreen";
import ScannerScreen from "../screens/ScannerScreen";
import ItemsScreen from "../screens/ItemsScreen";
import ImportScreen from "../screens/ImportScreen";
import TransactionsScreen from "../screens/TransactionsScreen";
import LoginScreen from "../screens/LoginScreen";
import AdminScreen from "../screens/AdminScreen";
import AdminPanelScreen from "../screens/AdminPanelScreen";
import BackupRestoreScreen from "../screens/BackupRestoreScreen";
import ItemMasterScreen from "../screens/ItemMasterScreen";
import BinContentScreen from "../screens/BinContentScreen";
import Colors from "../theme/colors";
import { isAdminRole, isCheckerRole } from "../utils/roles";
import { loadServerUrl } from "../services/api";
import {
  attemptSync,
  startAutoSync,
  startClearPoller,
} from "../services/syncService";

const Tab = createBottomTabNavigator();
const ItemsStack = createStackNavigator();
const AdminStack = createStackNavigator();

const ItemsStackNavigator = ({ role, onLogout }) => (
  <ItemsStack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: Colors.primary },
      headerTintColor: "#fff",
      headerTitleStyle: { fontWeight: "bold" },
    }}
  >
    <ItemsStack.Screen
      name="ItemsList"
      component={ItemsScreen}
      initialParams={{ role }}
      options={{
        title: "Items",
        ...(onLogout
          ? {
              headerRight: () => (
                <TouchableOpacity
                  onPress={onLogout}
                  style={{ marginRight: 14 }}
                >
                  <MaterialCommunityIcons
                    name="logout"
                    size={22}
                    color="#fff"
                  />
                </TouchableOpacity>
              ),
            }
          : {}),
      }}
    />
    <ItemsStack.Screen
      name="Import"
      component={ImportScreen}
      options={{ title: "Import CSV" }}
    />
    <ItemsStack.Screen
      name="ItemMaster"
      component={ItemMasterScreen}
      options={{ title: "Item Master" }}
    />
  </ItemsStack.Navigator>
);

const AdminStackNavigator = ({ username, role }) => (
  <AdminStack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: Colors.primary },
      headerTintColor: "#fff",
      headerTitleStyle: { fontWeight: "bold" },
    }}
  >
    <AdminStack.Screen
      name="AdminDashboard"
      component={AdminPanelScreen}
      options={{ title: "Admin Panel" }}
    />
    <AdminStack.Screen name="AdminUsers" options={{ title: "Manage Users" }}>
      {() => <AdminScreen viewerRole={role} />}
    </AdminStack.Screen>
    <AdminStack.Screen
      name="Import"
      component={ImportScreen}
      options={{ title: "Import CSV" }}
    />
    <AdminStack.Screen
      name="BackupRestore"
      component={BackupRestoreScreen}
      options={{ title: "Backup & Restore" }}
    />
    <AdminStack.Screen
      name="ItemMaster"
      component={ItemMasterScreen}
      options={{ title: "Item Master" }}
    />
    <AdminStack.Screen
      name="BinContent"
      component={BinContentScreen}
      options={{ title: "Bin Content" }}
    />
    <AdminStack.Screen
      name="AdminTransactions"
      options={{ title: "All Transactions" }}
    >
      {() => <TransactionsScreen username={username} role={role} scope="all" />}
    </AdminStack.Screen>
  </AdminStack.Navigator>
);

/** Decode the role claim from a JWT without a library.
 *  Returns null if the token is missing, malformed, or has no role. */
function decodeJwtRole(token) {
  try {
    const payload = token.split(".")[1];
    // Replace URL-safe chars and pad to a multiple of 4
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

export default function AppNavigator() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await loadServerUrl();
        const pairs = await AsyncStorage.multiGet([
          "workerName",
          "workerRole",
          "authToken",
        ]);
        const name = pairs[0][1];
        const storedRole = pairs[1][1];
        const token = pairs[2][1];
        if (name && (token || storedRole)) {
          // Prefer the role embedded in the JWT (always up-to-date) over the
          // cached AsyncStorage value, which may be missing on older installs.
          const tokenRole = token ? decodeJwtRole(token) : null;
          const role = tokenRole || storedRole || "worker";
          // Keep AsyncStorage in sync so future restores work even offline
          if (tokenRole && tokenRole !== storedRole) {
            AsyncStorage.setItem("workerRole", tokenRole).catch(() => {});
          }
          setSession({ username: name, role });
        }
      } catch (e) {
        console.warn("session restore error:", e);
      } finally {
        setChecking(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!session?.username) {
      return undefined;
    }

    // Checker role: items-only, no transactions — skip all background sync
    // to keep RAM usage minimal on low-end devices
    if (isCheckerRole(session.role)) {
      return undefined;
    }

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      attemptSync().catch(() => {});
    });
    const stopSync = startAutoSync(90000);
    const stopClearPoller = startClearPoller(15000);

    return () => {
      interactionTask?.cancel?.();
      stopSync?.();
      stopClearPoller?.();
    };
  }, [session]);

  if (checking) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Not logged in — show login screen
  if (!session) {
    return (
      <LoginScreen
        onLogin={(s) => {
          setSession(s);
        }}
      />
    );
  }

  const { username: workerName, role } = session;

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(["workerName", "workerRole", "authToken"]);
    setSession(null);
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ color, size }) => {
              const icons = {
                Dashboard: "view-dashboard",
                Scanner: "barcode-scan",
                Items: "package-variant",
                Transactions: "history",
                Admin: "account-cog",
              };
              return (
                <MaterialCommunityIcons
                  name={icons[route.name] || "circle"}
                  size={size}
                  color={color}
                />
              );
            },
            lazy: true,
            freezeOnBlur: true,
            tabBarActiveTintColor: Colors.primary,
            tabBarInactiveTintColor: Colors.textSecondary,
            tabBarStyle: {
              backgroundColor: Colors.card,
              borderTopColor: "#E0E0E0",
              elevation: 8,
            },
            headerStyle: { backgroundColor: Colors.primary },
            headerTintColor: "#fff",
            headerTitleStyle: { fontWeight: "bold" },
          })}
        >
          {!isCheckerRole(role) && (
            <Tab.Screen
              name="Dashboard"
              options={{
                title: `Dashboard · ${workerName}`,
                headerRight: () => (
                  <TouchableOpacity
                    onPress={handleLogout}
                    style={{ marginRight: 14 }}
                  >
                    <MaterialCommunityIcons
                      name="logout"
                      size={22}
                      color="#fff"
                    />
                  </TouchableOpacity>
                ),
              }}
            >
              {() => <DashboardScreen username={workerName} />}
            </Tab.Screen>
          )}
          {!isCheckerRole(role) && (
            <Tab.Screen name="Scanner" options={{ headerShown: false }}>
              {() => <ScannerScreen role={role} />}
            </Tab.Screen>
          )}
          <Tab.Screen name="Items" options={{ headerShown: false }}>
            {() => (
              <ItemsStackNavigator
                role={role}
                onLogout={isCheckerRole(role) ? handleLogout : undefined}
              />
            )}
          </Tab.Screen>
          {!isCheckerRole(role) && (
            <Tab.Screen
              name="Transactions"
              options={{
                title: "Transactions",
                headerRight: () => (
                  <TouchableOpacity
                    onPress={handleLogout}
                    style={{ marginRight: 14 }}
                  >
                    <MaterialCommunityIcons
                      name="account-switch"
                      size={22}
                      color="#fff"
                    />
                  </TouchableOpacity>
                ),
              }}
            >
              {() => (
                <TransactionsScreen
                  username={workerName}
                  role={role}
                  scope="self"
                />
              )}
            </Tab.Screen>
          )}
          {isAdminRole(role) && (
            <Tab.Screen
              name="Admin"
              options={{ headerShown: false, title: "Admin" }}
            >
              {() => <AdminStackNavigator username={workerName} role={role} />}
            </Tab.Screen>
          )}
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
});
