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
  RefreshControl,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  getItemBarcodes,
  getItemSummaries,
  searchItemSummaries,
} from "../database/db";
import ItemCard from "../components/ItemCard";
import Colors from "../theme/colors";

const PAGE_SIZE = 250;

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
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [showScanner, setShowScanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const searchTimer = useRef(null);
  const queryRef = useRef(null);
  const loadTokenRef = useRef(0);

  const runItemsQuery = useCallback(
    async ({ reset, searchText = "" }) => {
      const normalizedSearch = String(searchText || "").trim();
      const nextOffset = reset ? 0 : loadedCount;
      const token = ++loadTokenRef.current;

      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const results = normalizedSearch
          ? await searchItemSummaries(normalizedSearch, PAGE_SIZE)
          : await getItemSummaries(PAGE_SIZE, nextOffset);

        if (token !== loadTokenRef.current) {
          return;
        }

        setItems((prev) => (reset ? results : [...prev, ...results]));
        setLoadedCount(reset ? results.length : nextOffset + results.length);
        setHasMore(!normalizedSearch && results.length === PAGE_SIZE);
      } finally {
        if (token === loadTokenRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [loadedCount],
  );

  // Debounced DB search when query changes.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      runItemsQuery({ reset: true });
      return () => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
      };
    }

    searchTimer.current = setTimeout(() => {
      runItemsQuery({ reset: true, searchText: normalizedQuery });
    }, 250);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, runItemsQuery]);

  const totalBarcodesLoaded = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.barcodeCount || 0), 0),
    [items],
  );

  const loadMoreItems = useCallback(() => {
    if (loading || loadingMore || query.trim() || !hasMore) {
      return;
    }
    runItemsQuery({ reset: false });
  }, [hasMore, loading, loadingMore, query, runItemsQuery]);

  const loadBarcodesForItem = useCallback(async (item) => {
    return await getItemBarcodes(item.item_code, item.item_name);
  }, []);

  // Clear search query when user leaves this tab
  useFocusEffect(
    useCallback(() => {
      return () => {
        setQuery("");
      };
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await runItemsQuery({ reset: true, searchText: query.trim() });
    setRefreshing(false);
  }, [query, runItemsQuery]);

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
            ref={queryRef}
            style={styles.searchInput}
            placeholder="Search by name, item code or barcode..."
            value={query}
            onChangeText={(t) => setQuery(t.toUpperCase())}
            autoCapitalize="characters"
            clearButtonMode="never"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery("");
                queryRef.current?.focus();
              }}
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
        <TouchableOpacity
          style={[styles.importBtn, { backgroundColor: "#455A64" }]}
          onPress={onRefresh}
        >
          <MaterialCommunityIcons
            name={refreshing ? "loading" : "refresh"}
            size={20}
            color="#fff"
          />
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>
        {query.trim() ? "Showing " : ""}
        {items.length} unique product{items.length !== 1 ? "s" : ""}
        {totalBarcodesLoaded > 0
          ? ` (${totalBarcodesLoaded.toLocaleString()} barcodes loaded)`
          : ""}
        {query.trim() ? ' matching "' + query.trim() + '"' : ""}
        {!query.trim() && hasMore ? " • scroll for more" : ""}
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
          keyExtractor={(item) =>
            item.item_key || item.item_code || item.item_name
          }
          renderItem={({ item }) => (
            <ItemCard item={item} onLoadBarcodes={loadBarcodesForItem} />
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          onEndReached={loadMoreItems}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                color={Colors.primary}
                style={{ marginTop: 12, marginBottom: 8 }}
              />
            ) : null
          }
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
    marginLeft: 6,
  },
  scanBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 10,
    marginLeft: 6,
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
