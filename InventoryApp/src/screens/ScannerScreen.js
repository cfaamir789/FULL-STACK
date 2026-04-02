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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getItemByBarcode, getItemByItemCode, searchItems, insertTransaction } from '../database/db';
import { attemptSync } from '../services/syncService';
import Colors from '../theme/colors';

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState('barcode');
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
  const [itemName, setItemName] = useState('');
  const [nameResults, setNameResults] = useState([]);

  const fromBinRef = useRef(null);
  const toBinRef = useRef(null);
  const qtyRef = useRef(null);

  const focusFromBin = () => setTimeout(() => fromBinRef.current?.focus(), 120);

  const resetForm = () => {
    setScanned(false);
    setFoundItem(null);
    setBarcode('');
    setItemCode('');
    setItemName('');
    setNameResults([]);
    setFrombin('');
    setTobin('');
    setQty('');
    setShowCamera(true);
  };

  const switchMode = (m) => {
    setMode(m);
    resetForm();
  };

  // Camera scan: auto-fetch item + jump to From Bin
  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);
    setShowCamera(false);
    const code = data.trim();
    setBarcode(code);
    const item = await getItemByBarcode(code);
    setFoundItem(item);
    focusFromBin();
  };

  // Enter key or search button in barcode field
  const handleBarcodeSearch = async () => {
    if (!barcode.trim()) return;
    setSearching(true);
    const item = await getItemByBarcode(barcode.trim());
    setFoundItem(item);
    setShowCamera(false);
    setScanned(true);
    setSearching(false);
    focusFromBin();
  };

  // Enter key or search button in item code field
  const handleItemCodeSearch = async () => {
    if (!itemCode.trim()) return;
    setSearching(true);
    const item = await getItemByItemCode(itemCode.trim());
    setFoundItem(item);
    setScanned(true);
    if (item) setBarcode(item.barcode);
    setSearching(false);
    focusFromBin();
  };

  // Item name search — shows list of matches
  const handleItemNameSearch = async () => {
    if (!itemName.trim()) return;
    setSearching(true);
    const results = await searchItems(itemName.trim());
    const seen = new Set();
    const unique = results.filter(r => {
      if (seen.has(r.item_code)) return false;
      seen.add(r.item_code);
      return true;
    });
    setNameResults(unique);
    setSearching(false);
  };

  const handleNameResultSelect = (item) => {
    setFoundItem(item);
    setBarcode(item.barcode);
    setNameResults([]);
    setScanned(true);
    focusFromBin();
  };

  const handleSave = async () => {
    const barcodeVal = barcode.trim() || foundItem?.barcode;
    if (!barcodeVal) { Alert.alert('Error', 'Please search for an item first.'); return; }
    if (!frombin.trim() || !tobin.trim()) { Alert.alert('Error', 'From Bin and To Bin are required.'); return; }
    const qtyNum = parseInt(qty, 10);
    if (!qty || isNaN(qtyNum) || qtyNum < 1) { Alert.alert('Error', 'Quantity must be a positive number.'); return; }
    setSaving(true);
    try {
      const workerName = (await AsyncStorage.getItem('workerName')) || 'unknown';
      await insertTransaction({
        item_barcode: barcodeVal,
        item_code: foundItem?.item_code || '',
        item_name: foundItem?.item_name || 'Unknown Item',
        frombin: frombin.trim(),
        tobin: tobin.trim(),
        qty: qtyNum,
        worker_name: workerName,
      });
      await attemptSync();
      resetForm();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Reusable pieces ───────────────────────────────────────────────────────

  const renderTabs = () => (
    <View style={styles.tabRow}>
      <TouchableOpacity
        style={[styles.tab, mode === 'barcode' && styles.tabActive]}
        onPress={() => switchMode('barcode')}
      >
        <MaterialCommunityIcons name="barcode-scan" size={18} color={mode === 'barcode' ? '#fff' : Colors.textSecondary} />
        <Text style={[styles.tabText, mode === 'barcode' && styles.tabTextActive]}>Barcode</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, mode === 'itemcode' && styles.tabActive]}
        onPress={() => switchMode('itemcode')}
      >
        <MaterialCommunityIcons name="pound-box" size={18} color={mode === 'itemcode' ? '#fff' : Colors.textSecondary} />
        <Text style={[styles.tabText, mode === 'itemcode' && styles.tabTextActive]}>Item Code</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, mode === 'itemname' && styles.tabActive]}
        onPress={() => switchMode('itemname')}
      >
        <MaterialCommunityIcons name="text-search" size={18} color={mode === 'itemname' ? '#fff' : Colors.textSecondary} />
        <Text style={[styles.tabText, mode === 'itemname' && styles.tabTextActive]}>Item Name</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSearchInput = () =>
    mode === 'barcode' ? (
      <>
        <Text style={styles.label}>Barcode</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Scan or type barcode"
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={handleBarcodeSearch}
            blurOnSubmit={false}
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleBarcodeSearch}>
            {searching
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
          </TouchableOpacity>
        </View>
      </>
    ) : mode === 'itemcode' ? (
      <>
        <Text style={styles.label}>Item Code</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={itemCode}
            onChangeText={setItemCode}
            placeholder="Type item code"
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={handleItemCodeSearch}
            blurOnSubmit={false}
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleItemCodeSearch}>
            {searching
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
          </TouchableOpacity>
        </View>
      </>
    ) : (
      <>
        <Text style={styles.label}>Item Name</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={itemName}
            onChangeText={setItemName}
            placeholder="Type part of item name…"
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={handleItemNameSearch}
            blurOnSubmit={false}
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleItemNameSearch}>
            {searching
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
          </TouchableOpacity>
        </View>
        {nameResults.length > 0 && (
          <View style={styles.nameResultsList}>
            {nameResults.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.nameResultItem}
                onPress={() => handleNameResultSelect(r)}
              >
                <Text style={styles.nameResultCode}>Item Code: {r.item_code}</Text>
                <Text style={styles.nameResultName} numberOfLines={1}>{r.item_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {nameResults.length === 0 && itemName.trim().length > 0 && !searching && scanned === false && (
          <Text style={styles.nameHint}>Press search to find matching items</Text>
        )}
      </>
    );

  const renderItemBanner = () =>
    scanned ? (
      <View style={[styles.itemBanner, { backgroundColor: foundItem ? Colors.success + '18' : Colors.warning + '18' }]}>
        <MaterialCommunityIcons
          name={foundItem ? 'check-circle' : 'alert-circle'}
          size={18}
          color={foundItem ? Colors.success : Colors.warning}
        />
        <View style={{ marginLeft: 8, flex: 1 }}>
          <Text style={[styles.itemBannerText, { color: foundItem ? Colors.success : Colors.warning }]}>
            {foundItem ? foundItem.item_name : 'Item not found — will still be recorded'}
          </Text>
          {foundItem && (
            <Text style={styles.itemSubText}>
              Item Code: {foundItem.item_code}  |  Barcode: {foundItem.barcode}
            </Text>
          )}
        </View>
      </View>
    ) : null;

  const renderBinQtyFields = () => (
    <>
      <Text style={styles.label}>From Bin</Text>
      <TextInput
        ref={fromBinRef}
        style={styles.input}
        value={frombin}
        onChangeText={setFrombin}
        placeholder="e.g. A-01"
        autoCapitalize="characters"
        returnKeyType="next"
        onSubmitEditing={() => toBinRef.current?.focus()}
        blurOnSubmit={false}
      />

      <Text style={styles.label}>To Bin</Text>
      <TextInput
        ref={toBinRef}
        style={styles.input}
        value={tobin}
        onChangeText={setTobin}
        placeholder="e.g. B-03"
        autoCapitalize="characters"
        returnKeyType="next"
        onSubmitEditing={() => qtyRef.current?.focus()}
        blurOnSubmit={false}
      />

      <Text style={styles.label}>Quantity</Text>
      <TextInput
        ref={qtyRef}
        style={styles.input}
        value={qty}
        onChangeText={setQty}
        placeholder="Enter quantity"
        keyboardType="numeric"
        returnKeyType="done"
        onSubmitEditing={handleSave}
      />

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color="#fff" size="small" />
          : <MaterialCommunityIcons name="content-save" size={20} color="#fff" />}
        <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Transaction'}</Text>
      </TouchableOpacity>
    </>
  );

  // ─── Web ──────────────────────────────────────────────────────────────────
  if (IS_WEB) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
          {renderTabs()}
          <View style={{ paddingHorizontal: 16 }}>
            {renderSearchInput()}
            {renderItemBanner()}
            {renderBinQtyFields()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── Native permission checks ─────────────────────────────────────────────
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

  // ─── Native ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {renderTabs()}

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
          {renderSearchInput()}
          {renderItemBanner()}
          {renderBinQtyFields()}
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
    flexDirection: 'row', margin: 12,
    borderRadius: 10, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 10, gap: 6,
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#fff' },
  cameraWrap: { height: 240 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 220, height: 120, borderWidth: 2, borderColor: '#fff', borderRadius: 12 },
  scanHint: { color: '#fff', marginTop: 10, fontWeight: '600', fontSize: 13 },
  form: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  rescanBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  rescanText: { color: Colors.primary, fontWeight: '600', marginLeft: 6, fontSize: 14 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: Colors.card, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: Colors.textPrimary,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchBtn: { backgroundColor: Colors.primary, borderRadius: 8, padding: 11, marginLeft: 8 },
  itemBanner: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 8, padding: 10, marginTop: 8 },
  itemBannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
  itemSubText: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  nameResultsList: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    marginTop: 6, overflow: 'hidden', backgroundColor: Colors.card,
  },
  nameResultItem: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  nameResultCode: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  nameResultName: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, marginTop: 1 },
  nameResultBarcode: { fontSize: 11, color: Colors.textLight, marginTop: 1 },
  nameHint: { fontSize: 12, color: Colors.textLight, marginTop: 8, textAlign: 'center' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 14, marginTop: 20, elevation: 2,
  },
  saveBtnDisabled: { backgroundColor: Colors.textLight },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
});
