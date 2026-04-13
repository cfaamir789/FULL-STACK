import React, { useState, useEffect } from "react";
import { TouchableOpacity } from "react-native";
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
import Colors from "../theme/colors";
import { isAdminRole } from "../utils/roles";
import { loadServerUrl } from "../services/api";
import { attemptSync } from "../services/syncService";

const Tab = createBottomTabNavigator();
const ItemsStack = createStackNavigator();
const AdminStack = createStackNavigator();

const ItemsStackNavigator = ({ role }) => (
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
      options={{ title: "Items" }}
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
      name="AdminTransactions"
      options={{ title: "All Transactions" }}
    >
      {() => <TransactionsScreen username={username} role={role} />}
    </AdminStack.Screen>
  </AdminStack.Navigator>
);

export default function AppNavigator() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const init = async () => {
      // Load saved server IP before anything else
      await loadServerUrl();
      const pairs = await AsyncStorage.multiGet([
        "workerName",
        "workerRole",
        "authToken",
      ]);
      const name = pairs[0][1];
      const role = pairs[1][1];
      const token = pairs[2][1];
      if (name && (token || role)) {
        setSession({ username: name, role: role || "worker" });
        // Kick off a background sync (pulls items + sends pending transactions)
        attemptSync().catch(() => {});
      }
      setChecking(false);
    };
    init();
  }, []);

  // Still loading stored session
  if (checking) return null;

  // Not logged in — show login screen
  if (!session) {
    return (
      <LoginScreen
        onLogin={(s) => {
          setSession(s);
          // Pull items from backend immediately after login
          attemptSync().catch(() => {});
        }}
      />
    );
  }

  const { username: workerName, role } = session;

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
          <Tab.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{
              title: `Dashboard · ${workerName}`,
              headerRight: () => (
                <TouchableOpacity
                  onPress={async () => {
                    await AsyncStorage.multiRemove([
                      "workerName",
                      "workerRole",
                      "authToken",
                    ]);
                    setSession(null);
                  }}
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
          />
          <Tab.Screen name="Scanner" options={{ headerShown: false }}>
            {() => <ScannerScreen role={role} />}
          </Tab.Screen>
          <Tab.Screen name="Items" options={{ headerShown: false }}>
            {() => <ItemsStackNavigator role={role} />}
          </Tab.Screen>
          <Tab.Screen
            name="Transactions"
            options={{
              title: "Transactions",
              headerRight: () => (
                <TouchableOpacity
                  onPress={async () => {
                    await AsyncStorage.multiRemove([
                      "workerName",
                      "workerRole",
                      "authToken",
                    ]);
                    setSession(null);
                  }}
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
            {() => <TransactionsScreen username={workerName} role="worker" />}
          </Tab.Screen>
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
