import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { getAllItems, searchItems } from "../database/db";
import ItemCard from "../components/ItemCard";
import VoiceMic from "../components/VoiceMic";
import Colors from "../theme/colors";

const IS_WEB = Platform.OS === "web";
let CameraView, useCameraPermissions;
if (!IS_WEB) {
  try {
    const cam = require("expo-camera");
    CameraView = cam.CameraView;
    useCameraPermissions = cam.useCameraPermissions;
  } catch {
    CameraView = null;
    useCameraPermissions = () => [{ granted: false }, async () => {}];
  }
} else {
  useCameraPermissions = () => [{ granted: false }, async () => {}];
}

export default function ItemsScreen({ navigation, route }) {
  const role = route?.params?.role || "worker";
  const [allItems, setAllItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const searchTimer = useRef(null);

  // Load default items (limited) when no query
  const loadItems = useCallback(async () => {
    setLoading(true);
    const results = await getAllItems();
    setAllItems(results);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!query.trim()) loadItems();
    }, [loadItems, query]),
  );

  // Debounced DB search when query changes
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      loadItems();
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setLoading(true);
      const results = await searchItems(query.trim());
      setAllItems(results);
      setLoading(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  // Group raw items by trimmed item_code — one card per unique product
  const grouped = useMemo(() => {
    const map = new Map();
    for (const i of allItems) {
      const key = (i.item_code || i.item_name).trim().toLowerCase();
      if (map.has(key)) {
        map.get(key).barcodes.push(i.barcode);
      } else {
        map.set(key, {
          item_code: (i.item_code || "").trim(),
          item_name: i.item_name,
          barcodes: [i.barcode],
        });
      }
    }
    return Array.from(map.values());
  }, [allItems]);

  const items = grouped;

  const handleBarCodeScanned = ({ data }) => {
    setShowScanner(false);
    setQuery(data.trim());
  };

  const openScanner = async () => {
    if (IS_WEB) return;
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) return;
    }
    setShowScanner(true);
  };

  return (
    <View style={styles.container}>
      {/* Barcode scanner overlay */}
      {showScanner && !IS_WEB && CameraView && (
        <View style={styles.scannerOverlay}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{
              barcodeTypes: [
                "ean13",
                "ean8",
                "code128",
                "code39",
                "upc_a",
                "qr",
              ],
            }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <TouchableOpacity
            style={styles.scannerCloseBtn}
            onPress={() => setShowScanner(false)}
          >
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.scannerHint}>Scan a barcode to search</Text>
        </View>
      )}

      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={Colors.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, item code or barcode..."
            value={query}
            onChangeText={(t) => setQuery(t.toUpperCase())}
            autoCapitalize="characters"
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          <VoiceMic
            onResult={(t) => setQuery(t.toUpperCase())}
            size={18}
            style={{ backgroundColor: "transparent", marginRight: 2 }}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              style={{ padding: 4 }}
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={Colors.textLight}
              />
            </TouchableOpacity>
          )}
        </View>
        {!IS_WEB && (
          <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
            <MaterialCommunityIcons
              name="barcode-scan"
              size={20}
              color="#fff"
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => navigation.navigate("Import")}
        >
          <MaterialCommunityIcons name="file-import" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.importBtn, { backgroundColor: Colors.success }]}
          onPress={() => navigation.navigate("ItemMaster")}
          title="Item Master"
        >
          <MaterialCommunityIcons name="database-sync" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>
        {items.length} unique product{items.length !== 1 ? "s" : ""}
        {allItems.length !== items.length
          ? ` (${allItems.length.toLocaleString()} total barcodes)`
          : ""}
        {query.trim() ? ' matching "' + query.trim() + '"' : ""}
      </Text>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name="package-variant-closed"
            size={48}
            color={Colors.textLight}
          />
          <Text style={styles.emptyText}>
            {query
              ? "No items found"
              : "No items yet. Import a CSV to get started."}
          </Text>
          {!query && (
            <TouchableOpacity
              style={styles.emptyImportBtn}
              onPress={() => navigation.navigate("Import")}
            >
              <MaterialCommunityIcons
                name="file-import"
                size={20}
                color="#fff"
              />
              <Text style={styles.emptyImportText}>Import CSV</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.item_code || item.item_name}
          renderItem={({ item }) => <ItemCard item={item} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "web"}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.card,
    elevation: 2,
  },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    marginRight: 8,
  },
  searchIcon: { marginRight: 4 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  importBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 10,
  },
  countText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 12,
  },
  emptyImportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 16,
    elevation: 2,
  },
  emptyImportText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  scanBtn: {
    backgroundColor: Colors.success,
    borderRadius: 8,
    padding: 10,
    marginRight: 8,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: "#000",
  },
  scannerCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 101,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    padding: 6,
  },
  scannerHint: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
});
