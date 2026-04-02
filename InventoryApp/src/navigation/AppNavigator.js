import React, { useState, useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import DashboardScreen from '../screens/DashboardScreen';
import ScannerScreen from '../screens/ScannerScreen';
import ItemsScreen from '../screens/ItemsScreen';
import ImportScreen from '../screens/ImportScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import LoginScreen from '../screens/LoginScreen';
import Colors from '../theme/colors';

const Tab = createBottomTabNavigator();
const ItemsStack = createStackNavigator();

const ItemsStackNavigator = () => (
  <ItemsStack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: Colors.primary },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: 'bold' },
    }}
  >
    <ItemsStack.Screen name="ItemsList" component={ItemsScreen} options={{ title: 'Items' }} />
    <ItemsStack.Screen name="Import" component={ImportScreen} options={{ title: 'Import CSV' }} />
  </ItemsStack.Navigator>
);

export default function AppNavigator() {
  const [workerName, setWorkerName] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('workerName').then((name) => {
      setWorkerName(name || null);
      setChecking(false);
    });
  }, []);

  // Still loading stored name
  if (checking) return null;

  // No name saved yet — show login screen
  if (!workerName) {
    return <LoginScreen onLogin={(name) => setWorkerName(name)} />;
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, size }) => {
            const icons = {
              Dashboard: 'view-dashboard',
              Scanner: 'barcode-scan',
              Items: 'package-variant',
              Transactions: 'history',
            };
            return (
              <MaterialCommunityIcons
                name={icons[route.name] || 'circle'}
                size={size}
                color={color}
              />
            );
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textSecondary,
          tabBarStyle: {
            backgroundColor: Colors.card,
            borderTopColor: '#E0E0E0',
            elevation: 8,
          },
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: `Dashboard · ${workerName}` }} />
        <Tab.Screen name="Scanner" component={ScannerScreen} options={{ headerShown: false }} />
        <Tab.Screen
          name="Items"
          component={ItemsStackNavigator}
          options={{ headerShown: false }}
        />
        <Tab.Screen name="Transactions" component={TransactionsScreen} options={{
          title: 'Transactions',
          headerRight: () => (
            <TouchableOpacity
              onPress={async () => {
                await AsyncStorage.removeItem('workerName');
                setWorkerName(null);
              }}
              style={{ marginRight: 14 }}
            >
              <MaterialCommunityIcons name="account-switch" size={22} color="#fff" />
            </TouchableOpacity>
          ),
        }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
