import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Platform,
  Keyboard,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  fetchBinContentList,
  fetchBinContentMeta,
  fetchBinContentCategories,
  fetchBinContentZones,
  fetchBinContentStats,
} from "../services/api";
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

const PAGE_SIZE = 50;

const CHAMBERS = [
  "Chamber A",
  "Chamber B",
  "Chamber C",
  "High Value",
  "Bulk Warehouse",
];

const SORT_OPTIONS = [
  { key: "BinCode_asc", label: "Bin ↑" },
  { key: "BinCode_desc", label: "Bin ↓" },
  { key: "ItemCode_asc", label: "Item ↑" },
  { key: "ItemCode_desc", label: "Item ↓" },
  { key: "Qty_asc", label: "Qty ↑" },
  { key: "Qty_desc", label: "Qty ↓" },
  { key: "Category_asc", label: "Cat ↑" },
  { key: "Category_desc", label: "Cat ↓" },
];

// ─── Chip component ─────────────────────────────────────────────────────────
const Chip = React.memo(({ label, selected, onPress }) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
));

// ─── Bin Card component ─────────────────────────────────────────────────────
const BinCard = React.memo(({ item }) => {
  const qty = item.Qty ?? 0;
  const qtyColor =
    qty === 0 ? Colors.error : qty <= 5 ? Colors.warning : Colors.success;
  return (
    <View style={styles.binCard}>
      <View style={styles.binCardHeader}>
        <View style={styles.binCodeWrap}>
          <MaterialCommunityIcons
            name="archive-outline"
            size={16}
            color={Colors.primary}
          />
          <Text style={styles.binCodeText} numberOfLines={1}>
            {item.BinCode}
          </Text>
        </View>
        <View style={[styles.qtyBadge, { backgroundColor: qtyColor + "18" }]}>
          <Text style={[styles.qtyText, { color: qtyColor }]}>{qty}</Text>
        </View>
      </View>
      <View style={styles.binCardBody}>
        <Text style={styles.itemCodeText}>{item.ItemCode}</Text>
        {item.Item_Name ? (
          <Text style={styles.itemNameText}>{item.Item_Name}</Text>
        ) : null}
      </View>
      <View style={styles.binCardFooter}>
        {item.CategoryCode ? (
          <View style={styles.tagWrap}>
            <MaterialCommunityIcons
              name="tag-outline"
              size={12}
              color={Colors.textSecondary}
            />
            <Text style={styles.tagText}>{item.CategoryCode}</Text>
          </View>
        ) : null}
        {item.ZoneCode ? (
          <View style={styles.tagWrap}>
            <MaterialCommunityIcons
              name="map-marker-outline"
              size={12}
              color={Colors.textSecondary}
            />
            <Text style={styles.tagText}>{item.ZoneCode}</Text>
          </View>
        ) : null}
        {item.Chamber ? (
          <View style={styles.tagWrap}>
            <MaterialCommunityIcons
              name="warehouse"
              size={12}
              color={Colors.textSecondary}
            />
            <Text style={styles.tagText}>
              {item.Chamber}
              {item.Aisle ? ` · ${item.Aisle}` : ""}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function BinContentScreen() {
  // Data state
  const [bins, setBins] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Stats
  const [stats, setStats] = useState(null);

  // Scanner
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Search
  const [search, setSearch] = useState("");
  const searchTimer = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const filterAnim = useRef(new Animated.Value(0)).current;
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedChamber, setSelectedChamber] = useState(null);
  const [selectedSort, setSelectedSort] = useState("BinCode_asc");
  const [categories, setCategories] = useState([]);
  const [zones, setZones] = useState([]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (selectedCategory) c++;
    if (selectedZone) c++;
    if (selectedChamber) c++;
    if (selectedSort !== "BinCode_asc") c++;
    return c;
  }, [selectedCategory, selectedZone, selectedChamber, selectedSort]);

  // ─── Load filter options + stats on mount ──────────────────────────────────
  useEffect(() => {
    const loadMeta = async () => {
      try {
        const meta = await fetchBinContentMeta();
        if (meta.categories) setCategories(meta.categories);
        if (meta.zoneCodes) setZones(meta.zoneCodes);
        if (meta.stats) setStats(meta.stats);
      } catch (e) {
        // fallback: fetch individually if /meta not available
        try {
          const [cats, zns, st] = await Promise.all([
            fetchBinContentCategories(),
            fetchBinContentZones(),
            fetchBinContentStats(),
          ]);
          setCategories(cats);
          setZones(zns);
          setStats(st);
        } catch {}
      }
    };
    loadMeta();
  }, []);

  // ─── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // ─── Fetch bins ────────────────────────────────────────────────────────────
  const fetchBins = useCallback(
    async (pageNum = 1, append = false) => {
      try {
        setError(null);
        const params = {
          page: pageNum,
          limit: PAGE_SIZE,
          sort: selectedSort,
        };
        if (debouncedSearch) params.q = debouncedSearch;
        if (selectedCategory) params.categories = selectedCategory;
        if (selectedZone) params.zoneCodes = selectedZone;
        if (selectedChamber) params.chambers = selectedChamber;

        const data = await fetchBinContentList(params);
        const newBins = data.bins || [];

        if (append) {
          setBins((prev) => [...prev, ...newBins]);
        } else {
          setBins(newBins);
        }
        setTotal(data.total || 0);
        setTotalQty(data.totalQty || 0);
        setPage(pageNum);
        setHasMore(newBins.length === PAGE_SIZE);
      } catch (e) {
        setError(e.message || "Failed to load bin content");
      }
    },
    [
      debouncedSearch,
      selectedCategory,
      selectedZone,
      selectedChamber,
      selectedSort,
    ],
  );

  // ─── Initial load + re-fetch on filter/search change ──────────────────────
  useEffect(() => {
    setLoading(true);
    setBins([]);
    setPage(1);
    fetchBins(1, false).finally(() => setLoading(false));
  }, [fetchBins]);

  // ─── Pull-to-refresh ──────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [meta] = await Promise.all([
        fetchBinContentMeta().catch(() => null),
        fetchBins(1, false),
      ]);
      if (meta?.stats) setStats(meta.stats);
    } finally {
      setRefreshing(false);
    }
  }, [fetchBins]);

  // ─── Infinite scroll ──────────────────────────────────────────────────────
  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    fetchBins(page + 1, true).finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, page, fetchBins]);

  // ─── Toggle filter panel ──────────────────────────────────────────────────
  const toggleFilters = useCallback(() => {
    const toValue = showFilters ? 0 : 1;
    setShowFilters(!showFilters);
    Animated.timing(filterAnim, {
      toValue,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [showFilters, filterAnim]);

  // ─── Clear all filters ────────────────────────────────────────────────────
  const clearFilters = useCallback(() => {
    setSelectedCategory(null);
    setSelectedZone(null);
    setSelectedChamber(null);
    setSelectedSort("BinCode_asc");
    setSearch("");
  }, []);

  // ─── Render helpers ────────────────────────────────────────────────────────
  const renderBinItem = useCallback(({ item }) => <BinCard item={item} />, []);
  const keyExtractor = useCallback(
    (item) => item._id || `${item.BinCode}_${item.ItemCode}`,
    [],
  );

  const filterPanelHeight = filterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 340],
  });

  const ListEmptyComponent = useMemo(
    () =>
      !loading && !error ? (
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons
            name="package-variant"
            size={64}
            color={Colors.textLight}
          />
          <Text style={styles.emptyTitle}>No bins found</Text>
          <Text style={styles.emptySubtitle}>
            {debouncedSearch || activeFilterCount > 0
              ? "Try adjusting your search or filters"
              : "Bin content data not available"}
          </Text>
        </View>
      ) : null,
    [loading, error, debouncedSearch, activeFilterCount],
  );

  const ListFooterComponent = useMemo(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      ) : null,
    [loadingMore],
  );

  const openScanner = useCallback(async () => {
    if (IS_WEB) return;
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) return;
    }
    setShowScanner(true);
  }, [permission, requestPermission]);

  const handleBarCodeScanned = useCallback(({ data }) => {
    setShowScanner(false);
    setSearch(data.trim());
  }, []);

  return (
    <View style={styles.container}>
      {/* ─── Barcode Scanner Overlay ───────────────────────────────────── */}
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
            style={styles.scannerClose}
            onPress={() => setShowScanner(false)}
          >
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Stats Banner ──────────────────────────────────────────────── */}
      {stats && (
        <View style={styles.statsBanner}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {(stats.total ?? 0).toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>Records</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {(stats.uniqueBins ?? 0).toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>Bins</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {(stats.uniqueItems ?? 0).toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>Items</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {(stats.totalQty ?? 0).toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>Total Qty</Text>
          </View>
        </View>
      )}

      {/* ─── Search Bar ────────────────────────────────────────────────── */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={Colors.textSecondary}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search bin, item, description..."
            placeholderTextColor={Colors.textLight}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={openScanner}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="barcode-scan"
              size={22}
              color="#fff"
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.filterBtn}
          onPress={toggleFilters}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name={showFilters ? "filter-off" : "filter-variant"}
            size={22}
            color={showFilters ? Colors.primary : Colors.textSecondary}
          />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ─── Result count ──────────────────────────────────────────────── */}
      <View style={styles.resultRow}>
        <Text style={styles.resultText}>
          {loading
            ? "Loading..."
            : `${total.toLocaleString()} results · ${totalQty.toLocaleString()} qty`}
        </Text>
        {activeFilterCount > 0 && (
          <TouchableOpacity
            onPress={clearFilters}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.clearText}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ─── Filter Panel (animated) ───────────────────────────────────── */}
      <Animated.View
        style={[styles.filterPanel, { height: filterPanelHeight }]}
      >
        <View style={styles.filterInner}>
          {/* Category chips */}
          <Text style={styles.filterLabel}>Category</Text>
          <FlatList
            horizontal
            data={[null, ...categories]}
            keyExtractor={(c) => c || "__all__"}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: c }) => (
              <Chip
                label={c || "All"}
                selected={selectedCategory === c}
                onPress={() =>
                  setSelectedCategory(c === selectedCategory ? null : c)
                }
              />
            )}
          />

          {/* Zone chips */}
          <Text style={styles.filterLabel}>Zone</Text>
          <FlatList
            horizontal
            data={[null, ...zones]}
            keyExtractor={(z) => z || "__all__"}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: z }) => (
              <Chip
                label={z || "All"}
                selected={selectedZone === z}
                onPress={() => setSelectedZone(z === selectedZone ? null : z)}
              />
            )}
          />

          {/* Chamber chips */}
          <Text style={styles.filterLabel}>Chamber</Text>
          <FlatList
            horizontal
            data={[null, ...CHAMBERS]}
            keyExtractor={(c) => c || "__all__"}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: c }) => (
              <Chip
                label={c || "All"}
                selected={selectedChamber === c}
                onPress={() =>
                  setSelectedChamber(c === selectedChamber ? null : c)
                }
              />
            )}
          />

          {/* Sort chips */}
          <Text style={styles.filterLabel}>Sort</Text>
          <FlatList
            horizontal
            data={SORT_OPTIONS}
            keyExtractor={(s) => s.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: s }) => (
              <Chip
                label={s.label}
                selected={selectedSort === s.key}
                onPress={() => setSelectedSort(s.key)}
              />
            )}
          />
        </View>
      </Animated.View>

      {/* ─── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <View style={styles.errorBanner}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={16}
            color={Colors.error}
          />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => {
              setError(null);
              handleRefresh();
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Bin List ──────────────────────────────────────────────────── */}
      {loading && bins.length === 0 ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading bin content...</Text>
        </View>
      ) : (
        <FlatList
          data={bins}
          keyExtractor={keyExtractor}
          renderItem={renderBinItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[Colors.primary]}
            />
          }
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS !== "web"}
          getItemLayout={undefined}
        />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Stats banner
  statsBanner: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  statLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },

  // Search
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: Colors.textPrimary,
    paddingVertical: 0,
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  scanBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: "#000",
  },
  scannerClose: {
    position: "absolute",
    top: 48,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 24,
    padding: 8,
  },

  // Result row
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  resultText: { fontSize: 12, color: Colors.textSecondary },
  clearText: { fontSize: 12, color: Colors.primary, fontWeight: "600" },

  // Filter panel
  filterPanel: { overflow: "hidden" },
  filterInner: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  chipRow: { paddingHorizontal: 4, gap: 6 },

  // Chips
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: 12, color: Colors.textSecondary },
  chipTextSelected: { color: "#fff", fontWeight: "600" },

  // Bin card
  binCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  binCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  binCodeWrap: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  binCodeText: {
    fontSize: 15,
    fontWeight: "bold",
    color: Colors.primaryDark,
    letterSpacing: 0.3,
  },
  qtyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    minWidth: 36,
    alignItems: "center",
  },
  qtyText: { fontSize: 14, fontWeight: "bold" },
  binCardBody: { marginBottom: 6 },
  itemCodeText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  itemNameText: {
    fontSize: 13,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  binCardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tagWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  tagText: { fontSize: 11, color: Colors.textSecondary },

  // Empty state
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.textSecondary,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textLight,
    textAlign: "center",
    marginTop: 6,
  },

  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.error + "10",
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 12,
    borderRadius: 8,
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 12, color: Colors.error },
  retryText: { fontSize: 12, fontWeight: "600", color: Colors.primary },

  // Loaders
  centerLoader: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 10, color: Colors.textSecondary, fontSize: 13 },
  footerLoader: { paddingVertical: 16, alignItems: "center" },
  listContent: { paddingTop: 4, paddingBottom: 24 },
});
