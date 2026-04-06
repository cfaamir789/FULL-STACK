import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '../theme/colors';
import {
  checkSetup,
  loginUser,
  setupAdmin,
  loadServerUrl,
  setServerIp,
  DEFAULT_SERVER_IP,
} from '../services/api';

export default function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('loading');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [offlineRole, setOfflineRole] = useState('worker');
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverIpInput, setServerIpInput] = useState('');
  const [currentIp, setCurrentIp] = useState(DEFAULT_SERVER_IP);

  const tryConnect = async () => {
    setMode('loading');
    const ip = await loadServerUrl();
    setCurrentIp(ip);
    setServerIpInput(ip);
    try {
      const data = await checkSetup();
      setMode(data.needsSetup ? 'setup' : 'login');
    } catch {
      setMode('offline');
    }
  };

  useEffect(() => {
    tryConnect();
  }, []);

  const handleSaveServerIp = async () => {
    const trimmed = serverIpInput.trim();
    if (!trimmed) return;
    await setServerIp(trimmed);
    setCurrentIp(trimmed);
    setShowServerModal(false);
    tryConnect();
  };

  const handleSetup = async () => {
    const normalizedUsername = username.trim().toUpperCase();
    const normalizedPin = pin.trim();
    if (!normalizedUsername || !normalizedPin) {
      Alert.alert('Required', 'Username and PIN are required.');
      return;
    }
    if (normalizedPin.length < 4) {
      Alert.alert('Too short', 'PIN must be at least 4 digits.');
      return;
    }
    if (normalizedPin !== confirmPin.trim()) {
      Alert.alert('Mismatch', 'PINs do not match.');
      return;
    }

    setLoading(true);
    try {
      const data = await setupAdmin(normalizedUsername, normalizedPin);
      await AsyncStorage.multiSet([
        ['authToken', data.token],
        ['workerName', data.username],
        ['workerRole', data.role],
      ]);
      onLogin({ username: data.username, role: data.role });
    } catch (err) {
      Alert.alert('Setup failed', err?.response?.data?.error || err.message || 'Could not create admin account.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    const normalizedUsername = username.trim().toUpperCase();
    const normalizedPin = pin.trim();
    if (!normalizedUsername || !normalizedPin) {
      Alert.alert('Required', 'Username and PIN are required.');
      return;
    }

    setLoading(true);
    try {
      const data = await loginUser(normalizedUsername, normalizedPin);
      await AsyncStorage.multiSet([
        ['authToken', data.token],
        ['workerName', data.username],
        ['workerRole', data.role],
      ]);
      onLogin({ username: data.username, role: data.role });
    } catch (err) {
      Alert.alert('Login failed', err?.response?.data?.error || err.message || 'Invalid username or PIN.');
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineLogin = async () => {
    const normalizedName = offlineName.trim().toUpperCase();
    if (!normalizedName) {
      Alert.alert('Required', 'Enter your name.');
      return;
    }

    await AsyncStorage.multiSet([
      ['workerName', normalizedName],
      ['workerRole', offlineRole],
    ]);
    onLogin({ username: normalizedName, role: offlineRole });
  };

  const ServerModal = () => (
    <Modal visible={showServerModal} transparent animationType="fade" onRequestClose={() => setShowServerModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Server IP Address</Text>
          <Text style={styles.modalSub}>Enter the IP of the PC running the backend.</Text>
          <TextInput
            style={styles.input}
            value={serverIpInput}
            onChangeText={setServerIpInput}
            placeholder="e.g. 192.168.1.44"
            keyboardType="decimal-pad"
            autoFocus
          />
          <TouchableOpacity style={styles.button} onPress={handleSaveServerIp}>
            <MaterialCommunityIcons name="content-save" size={18} color="#fff" />
            <Text style={styles.buttonText}>Save & Reconnect</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowServerModal(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (mode === 'loading') {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Connecting to {currentIp}...</Text>
      </View>
    );
  }

  if (mode === 'offline') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ServerModal />
        <View style={styles.card}>
          <MaterialCommunityIcons name="wifi-off" size={48} color={Colors.warning} style={styles.icon} />
          <Text style={styles.title}>Server Offline</Text>
          <Text style={styles.subtitle}>Cannot reach server at {currentIp}:5000</Text>

          <TouchableOpacity style={styles.settingsRow} onPress={() => setShowServerModal(true)}>
            <MaterialCommunityIcons name="cog" size={16} color={Colors.primary} />
            <Text style={styles.settingsText}>Change Server IP</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.successButton]} onPress={tryConnect}>
            <MaterialCommunityIcons name="refresh" size={18} color="#fff" />
            <Text style={styles.buttonText}>Retry Connection</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>OR work offline</Text>
            <View style={styles.divider} />
          </View>

          <Text style={styles.label}>Your Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. AHMED"
            placeholderTextColor={Colors.textLight}
            value={offlineName}
            onChangeText={setOfflineName}
            autoCapitalize="characters"
          />

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleToggleRow}>
            <TouchableOpacity
              style={[styles.roleToggle, offlineRole === 'worker' && styles.roleToggleActive]}
              onPress={() => setOfflineRole('worker')}
            >
              <MaterialCommunityIcons name="account-hard-hat" size={16} color={offlineRole === 'worker' ? '#fff' : Colors.textSecondary} />
              <Text style={[styles.roleToggleText, offlineRole === 'worker' && styles.roleToggleTextActive]}>Worker</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleToggle, offlineRole === 'admin' && styles.roleToggleActive]}
              onPress={() => setOfflineRole('admin')}
            >
              <MaterialCommunityIcons name="shield-account" size={16} color={offlineRole === 'admin' ? '#fff' : Colors.textSecondary} />
              <Text style={[styles.roleToggleText, offlineRole === 'admin' && styles.roleToggleTextActive]}>Admin</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, !offlineName.trim() && styles.buttonDisabled]}
            onPress={handleOfflineLogin}
            disabled={!offlineName.trim()}
          >
            <MaterialCommunityIcons name="login" size={20} color="#fff" />
            <Text style={styles.buttonText}>Continue Offline</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (mode === 'setup') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ServerModal />
        <View style={styles.card}>
          <MaterialCommunityIcons name="shield-account" size={64} color={Colors.primary} style={styles.icon} />
          <Text style={styles.title}>First-time Setup</Text>
          <Text style={styles.subtitle}>Create the admin account</Text>

          <Text style={styles.label}>Admin Username</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. AAMIR"
            placeholderTextColor={Colors.textLight}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="characters"
            returnKeyType="next"
            autoFocus
          />

          <Text style={styles.label}>PIN (min 4 digits)</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter PIN"
            placeholderTextColor={Colors.textLight}
            value={pin}
            onChangeText={setPin}
            keyboardType="numeric"
            secureTextEntry
            returnKeyType="next"
          />

          <Text style={styles.label}>Confirm PIN</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter PIN"
            placeholderTextColor={Colors.textLight}
            value={confirmPin}
            onChangeText={setConfirmPin}
            keyboardType="numeric"
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSetup}
          />

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSetup} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="account-plus" size={20} color="#fff" />}
            <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Admin & Login'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingsRow} onPress={() => setShowServerModal(true)}>
            <MaterialCommunityIcons name="cog" size={16} color={Colors.textSecondary} />
            <Text style={styles.settingsText}>Server: {currentIp}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ServerModal />
      <View style={styles.card}>
        <MaterialCommunityIcons name="account-hard-hat" size={64} color={Colors.primary} style={styles.icon} />
        <Text style={styles.title}>Warehouse Inventory</Text>
        <Text style={styles.subtitle}>Login with your username and PIN</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. AAMIR"
          placeholderTextColor={Colors.textLight}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="characters"
          returnKeyType="next"
          autoFocus
        />

        <Text style={styles.label}>PIN</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter PIN"
          placeholderTextColor={Colors.textLight}
          value={pin}
          onChangeText={setPin}
          keyboardType="numeric"
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="login" size={20} color="#fff" />}
          <Text style={styles.buttonText}>{loading ? 'Logging in...' : 'Login'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingsRow} onPress={() => setShowServerModal(true)}>
          <MaterialCommunityIcons name="cog" size={16} color={Colors.textSecondary} />
          <Text style={styles.settingsText}>Server: {currentIp}</Text>
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
  centered: {
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: Colors.textSecondary,
    fontSize: 14,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 400,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  icon: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
    marginTop: 4,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    marginBottom: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 4,
  },
  successButton: {
    backgroundColor: Colors.success,
    marginBottom: 12,
  },
  buttonDisabled: {
    backgroundColor: Colors.textLight,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 16,
  },
  settingsText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginHorizontal: 8,
  },
  cancelBtn: {
    alignItems: 'center',
    marginTop: 12,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 380,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  modalSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  roleToggleRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  roleToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  roleToggleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  roleToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  roleToggleTextActive: {
    color: '#fff',
  },
});
