import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { Platform } from 'react-native';
const IS_WEB = Platform.OS === 'web';
let DocumentPicker = null;
let FileSystem = null;
if (!IS_WEB) {
  DocumentPicker = require('expo-document-picker');
  FileSystem = require('expo-file-system');
}
import Papa from 'papaparse';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { upsertItems } from '../database/db';
import { importItemsToBackend, checkHealth } from '../services/api';
import Colors from '../theme/colors';

export default function ImportScreen() {
  const [preview, setPreview] = useState([]);
  const [allParsed, setAllParsed] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handlePickCSV = async () => {
    setResult(null);
    setError(null);
    if (IS_WEB) {
      // Web: use native <input type="file">
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const firstRow = parsed.data[0];
        const hasNewFormat = firstRow && ('Barcode' in firstRow) && ('Item_Name' in firstRow);
        const hasOldFormat = firstRow && ('Barcode No.' in firstRow) && ('Item Description' in firstRow);
        if (!firstRow || (!hasNewFormat && !hasOldFormat)) {
          setError('CSV must have headers: ItemCode, Barcode, Item_Name (or Item No., Barcode No., Item Description)');
          return;
        }
        const items = parsed.data
          .filter((r) => (hasOldFormat ? r['Barcode No.'] && r['Item Description'] : r.Barcode && r.Item_Name))
          .map((r) => ({
            ItemCode: hasOldFormat ? (r['Item No.'] || r['Barcode No.']) : (r.ItemCode || r.Barcode),
            Barcode: String(hasOldFormat ? r['Barcode No.'] : r.Barcode).trim(),
            Item_Name: String(hasOldFormat ? r['Item Description'] : r.Item_Name).trim(),
          }));
        setAllParsed(items);
        setPreview(items.slice(0, 10));
      };
      input.click();
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (picked.canceled) return;

      const fileUri = picked.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });

      const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        setError('CSV parsing failed: ' + parsed.errors[0].message);
        return;
      }

      // Validate required columns
      const firstRow = parsed.data[0];
      const hasNewFormat = firstRow && ('Barcode' in firstRow) && ('Item_Name' in firstRow);
      const hasOldFormat = firstRow && ('Barcode No.' in firstRow) && ('Item Description' in firstRow);
      if (!firstRow || (!hasNewFormat && !hasOldFormat)) {
        setError('CSV must have headers: ItemCode, Barcode, Item_Name (or Item No., Barcode No., Item Description)');
        return;
      }

      // Normalize: ensure all required fields present
      const items = parsed.data
        .filter((row) => (hasOldFormat ? row['Barcode No.'] && row['Item Description'] : row.Barcode && row.Item_Name))
        .map((row) => ({
          ItemCode: hasOldFormat ? (row['Item No.'] || row['Barcode No.']) : (row.ItemCode || row.Barcode),
          Barcode: String(hasOldFormat ? row['Barcode No.'] : row.Barcode).trim(),
          Item_Name: String(hasOldFormat ? row['Item Description'] : row.Item_Name).trim(),
        }));

      setAllParsed(items);
      setPreview(items.slice(0, 10));
    } catch (err) {
      setError('Failed to read file: ' + err.message);
    }
  };

  const handleImport = async () => {
    if (allParsed.length === 0) return;
    setImporting(true);
    setResult(null);
    setError(null);

    try {
      // Save to local storage only — backend sync happens separately via sync service
      await upsertItems(allParsed);

      setResult({
        total: allParsed.length,
        backend: null,
      });
      setAllParsed([]);
      setPreview([]);
    } catch (err) {
      setError('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.description}>
        Pick a CSV file with headers: <Text style={styles.mono}>ItemCode, Barcode, Item_Name</Text>
      </Text>

      <TouchableOpacity style={styles.pickBtn} onPress={handlePickCSV}>
        <MaterialCommunityIcons name="file-upload" size={22} color="#fff" />
        <Text style={styles.pickBtnText}>Pick CSV File</Text>
      </TouchableOpacity>

      {error && (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {result && (
        <View style={styles.resultBox}>
          <MaterialCommunityIcons name="check-circle" size={18} color={Colors.success} />
          <Text style={styles.resultText}>
            {result.total} items imported to device.
            {result.backend
              ? ` ${result.backend.inserted + result.backend.modified} synced to server.`
              : ' Server unreachable — will sync when online.'}
          </Text>
        </View>
      )}

      {preview.length > 0 && (
        <View style={styles.previewSection}>
          <Text style={styles.previewTitle}>
            Preview (first {preview.length} of {allParsed.length} rows)
          </Text>

          {/* Table header */}
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>ItemCode</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>Barcode</Text>
            <Text style={[styles.tableCell, { flex: 2 }, styles.tableHeaderText]}>Item Name</Text>
          </View>

          {preview.map((row, idx) => (
            <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
              <Text style={styles.tableCell} numberOfLines={1}>{row.ItemCode}</Text>
              <Text style={styles.tableCell} numberOfLines={1}>{row.Barcode}</Text>
              <Text style={[styles.tableCell, { flex: 2 }]} numberOfLines={1}>{row.Item_Name}</Text>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.importBtn, importing && styles.importBtnDisabled]}
            onPress={handleImport}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons name="database-import" size={20} color="#fff" />
            )}
            <Text style={styles.importBtnText}>
              {importing ? 'Importing...' : `Import ${allParsed.length} Items`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: 16 },
  description: { fontSize: 14, color: Colors.textSecondary, marginBottom: 16, lineHeight: 20 },
  mono: { fontFamily: 'monospace', color: Colors.primary },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    paddingVertical: 14,
    elevation: 2,
  },
  pickBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.error + '15',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  errorText: { color: Colors.error, fontSize: 13, marginLeft: 8, flex: 1 },
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.success + '15',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  resultText: { color: Colors.success, fontSize: 13, marginLeft: 8, flex: 1 },
  previewSection: { marginTop: 20 },
  previewTitle: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableRowAlt: { backgroundColor: '#F9FAFB' },
  tableHeader: { backgroundColor: Colors.primary },
  tableHeaderText: { color: '#fff', fontWeight: '700' },
  tableCell: { flex: 1, fontSize: 12, padding: 8, color: Colors.textPrimary },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 16,
    elevation: 2,
  },
  importBtnDisabled: { backgroundColor: Colors.textLight },
  importBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 },
});
