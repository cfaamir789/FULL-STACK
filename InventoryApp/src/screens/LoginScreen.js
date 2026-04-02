import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '../theme/colors';

export default function LoginScreen({ onLogin }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleStart = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter your name before starting.');
      return;
    }
    setSaving(true);
    try {
      await AsyncStorage.setItem('workerName', trimmed);
      onLogin(trimmed);
    } catch (err) {
      Alert.alert('Error', 'Could not save name. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <MaterialCommunityIcons name="account-hard-hat" size={64} color={Colors.primary} style={styles.icon} />
        <Text style={styles.title}>Warehouse Inventory</Text>
        <Text style={styles.subtitle}>Enter your name to start working</Text>

        <TextInput
          style={styles.input}
          placeholder="Your name (e.g. Ahmed)"
          placeholderTextColor={Colors.textLight}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleStart}
          autoFocus
        />

        <TouchableOpacity
          style={[styles.button, !name.trim() && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={saving || !name.trim()}
        >
          <MaterialCommunityIcons name="login" size={20} color="#fff" />
          <Text style={styles.buttonText}>
            {saving ? 'Starting...' : 'Start Working'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 32,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 28,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    marginBottom: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    width: '100%',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: Colors.textLight,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
