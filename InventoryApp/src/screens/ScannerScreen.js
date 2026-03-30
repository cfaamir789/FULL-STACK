import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator, ScrollView,
} from 'react-native';

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
import { getItemByBarcode, getItemByItemCode, insertTransaction } from '../database/db';
import { attemptSync } from '../services/syncService';
import Colors from '../theme/colors';

// â”€â”€â”€ Search mode: 'barcode' | 'itemcode' â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState('barcode'); // 'barcode' | 'itemcode'
  const [scanned, setScanned] = useState(false);
  const [foundItem, setFoundItem] = useState(null);
  const [barcode, setBarcode] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [frombin, setFrombin] = useState('');
  const [tobin, setTobin] = useState('');
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  const [searching, setSearching] = useState(false);

  const resetForm = () => {
    setScanned(false);
    setFoundItem(null);
    setBarcode('');
    setItemCode('');
    setFrombin('');
    setTobin('');
    setQty('');
    setShowCamera(true);
  };

  const switchMode = (m) => {
    setMode(m);
    resetForm();
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);
    setShowCamera(false);
    const code = data.trim();
    setBarcode(code);
    const item = await getItemByBarcode(code);
    setFoundItem(item);
  };

  const handleBarcodeSearch = async () => {
    if (!barcode.trim()) return;
    setSearching(true);
    const item = await getItemByBarcode(barcode.trim());
    setFoundItem(item);
    setShowCamera(false);
    setScanned(true);
    setSearching(false);
  };

  const handleItemCodeSearch = async () => {
    if (!itemCode.trim()) return;
    setSearching(true);
    const item = await getItemByItemCode(itemCode.trim());
    setFoundItem(item);
    setScanned(true);
    if (item) setBarcode(item.barcode);
    setSearching(false);
  };

  const handleSave = async () => {
    const barcodeVal = barcode.trim() || foundItem?.barcode;
    if (!barcodeVal) {
      Alert.alert('Error', 'Please search for an item first.');
      return;
    }
    if (!frombin.trim() || !tobin.trim()) {
      Alert.alert('Error', 'From Bin and To Bin are required.');
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
        item_barcode: barcodeVal,
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
      Alert.alert('Error', 'Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // â”€â”€â”€ Shared form fields (bins + qty + save) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderFormFields = () => (
    <>
      {scanned && (
        <View style={[styles.itemBanner, { backgroundColor: foundItem ? Colors.success + '15' : Colors.warning + '15' }]}>
          <MaterialCommunityIcons
            name={foundItem ? 'check-circle' : 'alert-circle'}
            size={18}
            color={foundItem ? Colors.success : Colors.warning}
          />
          <View style={{ marginLeft: 8, flex: 1 }}>
            <Text style={[styles.itemBannerText, { color: foundItem ? Colors.success : Colors.warning }]}>
              {foundItem ? foundItem.item_name : 'Item not found â€” transaction will still be recorded'}
            </Text>
            {foundItem && (
              <Text style={styles.itemSubText}>
                Code: {foundItem.item_code}  |  Barcode: {foundItem.barcode}
              </Text>
            )}
          </View>
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
    </>
  );

  // â”€â”€â”€ Web view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (IS_WEB) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
          {/* Mode tabs */}
          <View style={styles.tabRow}>
            <TouchableOpacity style={[styles.tab, mode === 'barcode' && styles.tabActive]} onPress={() => switchMode('barcode')}>
              <MaterialCommunityIcons name="barcode-scan" size={18} color={mode === 'barcode' ? '#fff' : Colors.textSecondary} />
              <Text style={[styles.tabText, mode === 'barcode' && styles.tabTextActive]}>Barcode</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, mode === 'itemcode' && styles.tabActive]} onPress={() => switchMode('itemcode')}>
              <MaterialCommunityIcons name="pound-box" size={18} color={mode === 'itemcode' ? '#fff' : Colors.textSecondary} />
              <Text style={[styles.tabText, mode === 'itemcode' && styles.tabTextActive]}>Item Code</Text>
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            {mode === 'barcode' ? (
              <>
                <Text style={styles.label}>Barcode</Text>
                <View style={styles.searchRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={barcode}
                    onChangeText={setBarcode}
                    placeholder="Scan or type barcode"
                    autoCapitalize="none"
                    onSubmitEditing={handleBarcodeSearch}
                    returnKeyType="search"
                  />
                  <TouchableOpacity style={styles.searchBtn} onPress={handleBarcodeSearch}>
                    {searching ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.label}>Item Code</Text>
                <View style={styles.searchRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={itemCode}
                    onChangeText={setItemCode}
                    placeholder="Type item code"
                    autoCapitalize="none"
                    onSubmitEditing={handleItemCodeSearch}
                    returnKeyType="search"
                  />
                  <TouchableOpacity style={styles.searchBtn} onPress={handleItemCodeSearch}>
                    {searching ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
                  </TouchableOpacity>
                </View>
              </>
            )}
            {renderFormFields()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // â”€â”€â”€ Native permission checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!permission) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

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

  // â”€â”€â”€ Native view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {/* Mode tabs */}
        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tab, mode === 'barcode' && styles.tabActive]} onPress={() => switchMode('barcode')}>
            <MaterialCommunityIcons name="barcode-scan" size={18} color={mode === 'barcode' ? '#fff' : Colors.textSecondary} />
            <Text style={[styles.tabText, mode === 'barcode' && styles.tabTextActive]}>Barcode</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, mode === 'itemcode' && styles.tabActive]} onPress={() => switchMode('itemcode')}>
            <MaterialCommunityIcons name="pound-box" size={18} color={mode === 'itemcode' ? '#fff' : Colors.textSecondary} />
            <Text style={[styles.tabText, mode === 'itemcode' && styles.tabTextActive]}>Item Code</Text>
          </TouchableOpacity>
        </View>

        {/* Camera â€” only in barcode mode */}
        {mode === 'barcode' && showCamera && (
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

        <ScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 32 }}>
          {!showCamera && mode === 'barcode' && (
            <TouchableOpacity style={styles.rescanBtn} onPress={resetForm}>
              <MaterialCommunityIcons name="barcode-scan" size={18} color={Colors.primary} />
              <Text style={styles.rescanText}>Scan Again</Text>
            </TouchableOpacity>
          )}

          {mode === 'barcode' ? (
            <>
              <Text style={styles.label}>Barcode</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={barcode}
                  onChangeText={setBarcode}
                  placeholder="Scan or type barcode"
                  autoCapitalize="none"
                  onSubmitEditing={handleBarcodeSearch}
                  returnKeyType="search"
                />
                <TouchableOpacity style={styles.searchBtn} onPress={handleBarcodeSearch}>
                  {searching ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Item Code</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={itemCode}
                  onChangeText={setItemCode}
                  placeholder="Type item code"
                  autoCapitalize="none"
                  onSubmitEditing={handleItemCodeSearch}
                  returnKeyType="search"
                />
                <TouchableOpacity style={styles.searchBtn} onPress={handleItemCodeSearch}>
                  {searching ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
                </TouchableOpacity>
              </View>
            </>
          )}

          {renderFormFields()}
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
  tabRow: {
    flexDirection: 'row',
    margin: 12,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#fff' },
  cameraWrap: { height: 260 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 220, height: 130, borderWidth: 2, borderColor: '#fff', borderRadius: 12 },
  scanHint: { color: '#fff', marginTop: 10, fontWeight: '600', fontSize: 13 },
  form: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  rescanBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
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
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchBtn: { backgroundColor: Colors.primary, borderRadius: 8, padding: 11, marginLeft: 8 },
  itemBanner: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 8, padding: 10, marginTop: 8 },
  itemBannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
  itemSubText: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 14, marginTop: 24, elevation: 2,
  },
  saveBtnDisabled: { backgroundColor: Colors.textLight },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
});
