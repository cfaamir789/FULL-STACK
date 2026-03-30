import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator, ScrollView,
} from 'react-native';

// expo-camera is not available on web
const IS_WEB = Platform.OS === 'web';
let CameraView, useCameraPermissions;
if (!IS_WEB) {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
} else {
  useCameraPermissions = () => [{ granted: false }, async () => {}];
}
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getItemByBarcode, insertTransaction } from '../database/db';
import { attemptSync } from '../services/syncService';
import Colors from '../theme/colors';

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [foundItem, setFoundItem] = useState(null);
  const [barcode, setBarcode] = useState('');
  const [frombin, setFrombin] = useState('');
  const [tobin, setTobin] = useState('');
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCamera, setShowCamera] = useState(true);

  // Reset when leaving the screen
  const resetForm = () => {
    setScanned(false);
    setFoundItem(null);
    setBarcode('');
    setFrombin('');
    setTobin('');
    setQty('');
    setShowCamera(true);
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);
    setShowCamera(false);

    const code = data.trim();
    setBarcode(code);
    const item = await getItemByBarcode(code);
    setFoundItem(item); // may be null if not found
  };

  const handleManualSearch = async () => {
    if (!barcode.trim()) return;
    const item = await getItemByBarcode(barcode.trim());
    setFoundItem(item);
    setShowCamera(false);
    setScanned(true);
  };

  const handleSave = async () => {
    if (!barcode.trim()) {
      Alert.alert('Error', 'Barcode is required.');
      return;
    }
    if (!frombin.trim() || !tobin.trim()) {
      Alert.alert('Error', 'Frombin and Tobin are required.');
      return;
    }
    const qtyNum = parseInt(qty, 10);
    if (!qty || isNaN(qtyNum) || qtyNum < 1) {
      Alert.alert('Error', 'Quantity must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      await insertTransaction({
        item_barcode: barcode.trim(),
        item_name: foundItem?.item_name || 'Unknown Item',
        frombin: frombin.trim(),
        tobin: tobin.trim(),
        qty: qtyNum,
      });
      await attemptSync();
      Alert.alert('Saved', 'Transaction recorded successfully.', [
        { text: 'Scan Again', onPress: resetForm },
      ]);
    } catch (err) {
      Alert.alert('Error', 'Failed to save transaction: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (IS_WEB) {
    return (
      <View style={[styles.container, styles.center]}>
        <MaterialCommunityIcons name="monitor" size={48} color={Colors.textLight} />
        <Text style={[styles.permText, { marginTop: 12 }]}>Camera scanning is not available in the web preview.</Text>
        <Text style={[styles.permText, { fontSize: 12 }]}>Use Expo Go on your Android phone to scan barcodes.</Text>
        <Text style={[styles.permText, { fontSize: 12, marginTop: 8 }]}>You can still enter barcodes manually below:</Text>
        <ScrollView style={{ width: '100%', paddingHorizontal: 16 }}>
          <Text style={styles.label}>Barcode</Text>
          <View style={styles.barcodeRow}>
            <TextInput style={[styles.input, { flex: 1 }]} value={barcode} onChangeText={setBarcode} placeholder="Type barcode manually" autoCapitalize="none" />
            <TouchableOpacity style={styles.searchBtn} onPress={handleManualSearch}><MaterialCommunityIcons name="magnify" size={22} color="#fff" /></TouchableOpacity>
          </View>
          {scanned && (
            <View style={[styles.itemBanner, { backgroundColor: foundItem ? Colors.success + '15' : Colors.warning + '15' }]}>
              <MaterialCommunityIcons name={foundItem ? 'check-circle' : 'alert-circle'} size={18} color={foundItem ? Colors.success : Colors.warning} />
              <Text style={[styles.itemBannerText, { color: foundItem ? Colors.success : Colors.warning }]}>{foundItem ? foundItem.item_name : 'Item not found — transaction will still be recorded'}</Text>
            </View>
          )}
          <Text style={styles.label}>From Bin</Text>
          <TextInput style={styles.input} value={frombin} onChangeText={setFrombin} placeholder="e.g. A-01" autoCapitalize="characters" />
          <Text style={styles.label}>To Bin</Text>
          <TextInput style={styles.input} value={tobin} onChangeText={setTobin} placeholder="e.g. B-03" autoCapitalize="characters" />
          <Text style={styles.label}>Quantity</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} placeholder="Enter quantity" keyboardType="numeric" />
          <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="content-save" size={20} color="#fff" />}
            <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Transaction'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="camera-off" size={48} color={Colors.textLight} />
        <Text style={styles.permText}>Camera permission is required for scanning.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Camera viewfinder */}
        {showCamera && (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'] }}
            />
            <View style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.scanHint}>Point camera at barcode</Text>
            </View>
          </View>
        )}

        {/* Form */}
        <ScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 32 }}>
          {!showCamera && (
            <TouchableOpacity style={styles.rescanBtn} onPress={resetForm}>
              <MaterialCommunityIcons name="barcode-scan" size={18} color={Colors.primary} />
              <Text style={styles.rescanText}>Scan Again</Text>
            </TouchableOpacity>
          )}

          {/* Barcode field (manual entry) */}
          <Text style={styles.label}>Barcode</Text>
          <View style={styles.barcodeRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={barcode}
              onChangeText={setBarcode}
              placeholder="Scan or type barcode"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleManualSearch}>
              <MaterialCommunityIcons name="magnify" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Item found / not found banner */}
          {scanned && (
            <View style={[styles.itemBanner, { backgroundColor: foundItem ? Colors.success + '15' : Colors.warning + '15' }]}>
              <MaterialCommunityIcons
                name={foundItem ? 'check-circle' : 'alert-circle'}
                size={18}
                color={foundItem ? Colors.success : Colors.warning}
              />
              <Text style={[styles.itemBannerText, { color: foundItem ? Colors.success : Colors.warning }]}>
                {foundItem ? foundItem.item_name : 'Item not found — transaction will still be recorded'}
              </Text>
            </View>
          )}

          <Text style={styles.label}>From Bin</Text>
          <TextInput
            style={styles.input}
            value={frombin}
            onChangeText={setFrombin}
            placeholder="e.g. A-01"
            autoCapitalize="characters"
          />

          <Text style={styles.label}>To Bin</Text>
          <TextInput
            style={styles.input}
            value={tobin}
            onChangeText={setTobin}
            placeholder="e.g. B-03"
            autoCapitalize="characters"
          />

          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            value={qty}
            onChangeText={setQty}
            placeholder="Enter quantity"
            keyboardType="numeric"
          />

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons name="content-save" size={20} color="#fff" />
            )}
            <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Transaction'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permText: { color: Colors.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 16 },
  permBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  permBtnText: { color: '#fff', fontWeight: '700' },
  cameraWrap: { height: 280 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: {
    width: 220,
    height: 140,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
  },
  scanHint: { color: '#fff', marginTop: 12, fontWeight: '600', fontSize: 13 },
  form: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  rescanBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  rescanText: { color: Colors.primary, fontWeight: '600', marginLeft: 6, fontSize: 14 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  barcodeRow: { flexDirection: 'row', alignItems: 'center' },
  searchBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 11,
    marginLeft: 8,
  },
  itemBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  itemBannerText: { fontSize: 13, fontWeight: '600', marginLeft: 8, flex: 1 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 24,
    elevation: 2,
  },
  saveBtnDisabled: { backgroundColor: Colors.textLight },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
});
