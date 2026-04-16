import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Vibration,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";

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
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getItemByBarcode,
  getItemByItemCode,
  searchItemsByItemCode,
  searchItems,
  searchItemsByName,
  insertTransaction,
} from "../database/db";
import { attemptSync } from "../services/syncService";
import CalcInput from "../components/CalcInput";
// ClearButton — shows ✕ inside the input when there is text, invisible when empty
const ClearButton = ({ value, onClear, style }) => {
  if (!value) return null;
  return (
    <TouchableOpacity
      onPress={onClear}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[{ marginRight: 8, padding: 2 }, style]}
    >
      <MaterialCommunityIcons name="close-circle" size={18} color="#9e9e9e" />
    </TouchableOpacity>
  );
};
import Colors from "../theme/colors";
import { isAdminRole } from "../utils/roles";

export default function ScannerScreen({ role = "worker" }) {
  const canUseAdvancedModes = isAdminRole(role);
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState("barcode");
  const [scanned, setScanned] = useState(false);
  const [foundItem, setFoundItem] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [quickCode, setQuickCode] = useState("");
  const [frombin, setFrombin] = useState("");
  const [tobin, setTobin] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [searching, setSearching] = useState(false);
  const [itemName, setItemName] = useState("");
  const [nameResults, setNameResults] = useState([]);
  const [quickCodeResults, setQuickCodeResults] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);

  const fromBinRef = useRef(null);
  const toBinRef = useRef(null);
  const qtyRef = useRef(null);
  const notesRef = useRef(null);
  const barcodeRef = useRef(null);
  const itemCodeRef = useRef(null);
  const quickCodeRef = useRef(null);
  const itemNameRef = useRef(null);
  const nameSearchTimer = useRef(null);

  const digitsOnly = (text) => String(text || "").replace(/\D+/g, "");

  const focusFromBin = () => setTimeout(() => fromBinRef.current?.focus(), 120);

  // Live search as user types in Item Name mode
  useEffect(() => {
    if (mode !== "itemname") return;
    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (!itemName.trim() || itemName.trim().length < 2) {
      setNameResults([]);
      return;
    }
    nameSearchTimer.current = setTimeout(async () => {
      setSearching(true);
      const results = await searchItemsByName(itemName.trim());
      const seen = new Set();
      const unique = results.filter((r) => {
        if (seen.has(r.item_code)) return false;
        seen.add(r.item_code);
        return true;
      });
      setNameResults(unique);
      setSearching(false);
    }, 300);
    return () => {
      if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    };
  }, [itemName, mode]);

  useFocusEffect(
    useCallback(() => {
      if ((mode === "barcode" || mode === "itemcode") && showCamera) {
        setCameraActive(true);
      }
      // Auto-focus the active tab's input when screen is navigated to
      setTimeout(() => {
        if (mode === "barcode") barcodeRef.current?.focus();
        else if (mode === "itemcode") itemCodeRef.current?.focus();
        else if (mode === "quickcode") quickCodeRef.current?.focus();
        else if (mode === "itemname") itemNameRef.current?.focus();
      }, 200);
      return () => setCameraActive(false);
    }, [mode, showCamera]),
  );

  const resetForm = () => {
    setScanned(false);
    setFoundItem(null);
    setBarcode("");
    setItemCode("");
    setQuickCode("");
    setItemName("");
    setNameResults([]);
    setQuickCodeResults([]);
    setFrombin("");
    setTobin("");
    setQty("");
    setNotes("");
    setShowCamera(false);
    setCameraActive(false);
    setTorchOn(false);
  };

  const openScanner = () => {
    setShowCamera(true);
    setCameraActive(true);
    setScanned(false);
    setTorchOn(false);
  };

  const switchMode = (m) => {
    setMode(m);
    setScanned(false);
    setFoundItem(null);
    setBarcode("");
    setItemCode("");
    setQuickCode("");
    setItemName("");
    setNameResults([]);
    setQuickCodeResults([]);
    setFrombin("");
    setTobin("");
    setQty("");
    setNotes("");
    setShowCamera(false);
    setCameraActive(false);
    setTorchOn(false);
    // Auto-focus the primary input of the selected tab
    setTimeout(() => {
      if (m === "barcode") barcodeRef.current?.focus();
      else if (m === "itemcode") itemCodeRef.current?.focus();
      else if (m === "quickcode") quickCodeRef.current?.focus();
      else if (m === "itemname") itemNameRef.current?.focus();
    }, 120);
  };

  const applySelectedItem = (item) => {
    if (!item) {
      setFoundItem(null);
      setScanned(true);
      focusFromBin();
      return;
    }

    setFoundItem(item);
    setBarcode(item.barcode || "");
    setItemCode(item.item_code || "");
    setQuickCode(item.item_code || "");
    setItemName(item.item_name || "");
    setScanned(true);
    setNameResults([]);
    setQuickCodeResults([]);
    focusFromBin();
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);
    setShowCamera(false);
    setCameraActive(false);
    const code = digitsOnly(data.trim());
    setBarcode(code);
    if (!IS_WEB) Vibration.vibrate(100);
    const item = await getItemByBarcode(code);
    applySelectedItem(item);
  };

  const handleBarcodeSearch = async () => {
    if (!barcode.trim()) return;
    setSearching(true);
    const item = await getItemByBarcode(barcode.trim());
    applySelectedItem(item);
    setShowCamera(false);
    setCameraActive(false);
    setSearching(false);
  };

  const handleItemCodeSearch = async () => {
    if (!itemCode.trim()) return;
    setSearching(true);
    const item = await getItemByItemCode(itemCode.trim());
    applySelectedItem(item);
    setSearching(false);
  };

  const handleItemCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);
    setShowCamera(false);
    setCameraActive(false);
    const code = digitsOnly(data.trim());
    setItemCode(code);
    if (!IS_WEB) Vibration.vibrate(100);
    const item = await getItemByItemCode(code);
    applySelectedItem(item);
  };

  const handleQuickCodeSearch = async () => {
    const query = digitsOnly(quickCode);
    if (!query.trim()) return;
    if (query.trim().length < 3) {
      Alert.alert(
        "Need More Digits",
        "Enter at least 3 digits from the item code for quick matching.",
      );
      return;
    }
    setSearching(true);
    const results = await searchItemsByItemCode(query.trim(), 50);
    setQuickCodeResults(results);
    setScanned(false);
    setFoundItem(null);
    if (results.length === 1) {
      applySelectedItem(results[0]);
    }
    setSearching(false);
  };

  const handleItemNameSearch = async () => {
    if (!itemName.trim()) return;
    setSearching(true);
    const results = await searchItemsByName(itemName.trim());
    const seen = new Set();
    const unique = results.filter((r) => {
      if (seen.has(r.item_code)) return false;
      seen.add(r.item_code);
      return true;
    });
    setNameResults(unique);
    setSearching(false);
  };

  const handleNameResultSelect = (item) => {
    applySelectedItem(item);
  };

  const handleQuickCodeResultSelect = (item) => {
    applySelectedItem(item);
  };

  // directQty is passed from CalcInput's SAVE button to avoid stale React state.
  const handleSave = async (directQty) => {
    const barcodeVal = barcode.trim() || foundItem?.barcode;
    if (!barcodeVal) {
      Alert.alert("Missing Item", "Please scan or search for an item first.");
      return;
    }
    if (!foundItem) {
      Alert.alert("Unknown Item", "This barcode is not in the item master. Please sync items first.");
      return;
    }
    if (!frombin.trim() || !tobin.trim()) {
      Alert.alert("Missing Bins", "From Bin and To Bin are required.");
      return;
    }
    // Use directQty if it's a valid numeric string (from CalcInput), else fall back to state
    const qtyStr =
      typeof directQty === "string" && /^\d+(\.\d+)?$/.test(directQty)
        ? directQty
        : qty;
    const qtyNum = parseInt(qtyStr, 10);
    if (!qtyStr || isNaN(qtyNum) || qtyNum < 1) {
      Alert.alert(
        "Invalid Quantity",
        "Tap the quantity field, enter a number, then press SAVE.",
      );
      return;
    }
    setSaving(true);
    try {
      const workerName =
        (await AsyncStorage.getItem("workerName")) || "unknown";
      await insertTransaction({
        item_barcode: barcodeVal,
        item_code: foundItem?.item_code || "",
        item_name: foundItem?.item_name || "Unknown Item",
        frombin: frombin.trim().toUpperCase(),
        tobin: tobin.trim().toUpperCase(),
        qty: qtyNum,
        worker_name: workerName,
        notes: notes.trim().toUpperCase(),
      });
      setLastSaved({
        name: foundItem?.item_name || "Unknown Item",
        qty: qtyNum,
        from: frombin.trim().toUpperCase(),
        to: tobin.trim().toUpperCase(),
      });
      resetForm();
      setSaving(false);
      attemptSync().catch(() => {});
      setTimeout(() => {
        if (mode === "barcode") barcodeRef.current?.focus();
        else if (mode === "itemcode") itemCodeRef.current?.focus();
        else if (mode === "quickcode") quickCodeRef.current?.focus();
        else if (mode === "itemname") itemNameRef.current?.focus();
      }, 50);
    } catch (err) {
      Alert.alert("Error", err.message);
      setSaving(false);
    }
  };

  const uc = (setter) => (text) => setter(text.toUpperCase());

  // ─── Reusable UI pieces ─────────────────────────────────────────────────────

  const renderTabs = () => (
    <View style={styles.tabRow}>
      {[
        { key: "barcode", icon: "barcode-scan", label: "Barcode" },
        { key: "itemcode", icon: "pound-box", label: "Item Code" },
        ...(canUseAdvancedModes
          ? [
              { key: "quickcode", icon: "dialpad", label: "Quick Code" },
              { key: "itemname", icon: "text-search", label: "Item Name" },
            ]
          : []),
      ].map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[styles.tab, mode === t.key && styles.tabActive]}
          onPress={() => switchMode(t.key)}
        >
          <MaterialCommunityIcons
            name={t.icon}
            size={18}
            color={mode === t.key ? "#fff" : Colors.textSecondary}
          />
          <Text
            style={[styles.tabText, mode === t.key && styles.tabTextActive]}
          >
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderSearchInput = () => {
    if (mode === "barcode") {
      return (
        <>
          <Text style={styles.label}>Barcode</Text>
          <View style={styles.searchRow}>
            <View style={styles.inputWithMic}>
              <TextInput
                ref={barcodeRef}
                style={styles.inputInner}
                value={barcode}
                onChangeText={(t) => setBarcode(digitsOnly(t))}
                placeholder="Scan or type barcode"
                keyboardType={IS_WEB ? "default" : "number-pad"}
                returnKeyType="search"
                onSubmitEditing={handleBarcodeSearch}
                onKeyPress={(e) => {
                  if (e.nativeEvent.key === "Enter") handleBarcodeSearch();
                }}
                blurOnSubmit={false}
              />
              <ClearButton value={barcode} onClear={() => setBarcode("")} />
            </View>
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={handleBarcodeSearch}
            >
              {searching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons name="magnify" size={22} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </>
      );
    }
    if (mode === "itemcode") {
      return (
        <>
          <Text style={styles.label}>Item Code</Text>
          <View style={styles.searchRow}>
            <View style={styles.inputWithMic}>
              <TextInput
                ref={itemCodeRef}
                style={styles.inputInner}
                value={itemCode}
                onChangeText={(t) => setItemCode(digitsOnly(t))}
                placeholder="Type item code"
                keyboardType={IS_WEB ? "default" : "number-pad"}
                returnKeyType="search"
                onSubmitEditing={handleItemCodeSearch}
                onKeyPress={(e) => {
                  if (e.nativeEvent.key === "Enter") handleItemCodeSearch();
                }}
                blurOnSubmit={false}
              />
              <ClearButton value={itemCode} onClear={() => setItemCode("")} />
            </View>
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={handleItemCodeSearch}
            >
              {searching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons name="magnify" size={22} color="#fff" />
              )}
            </TouchableOpacity>
            {!IS_WEB && (
              <TouchableOpacity
                style={styles.searchBtn}
                onPress={() => {
                  setShowCamera(true);
                  setCameraActive(true);
                  setScanned(false);
                }}
              >
                <MaterialCommunityIcons
                  name="barcode-scan"
                  size={22}
                  color="#fff"
                />
              </TouchableOpacity>
            )}
          </View>
        </>
      );
    }
    if (mode === "quickcode") {
      return (
        <>
          <Text style={styles.label}>Quick Code</Text>
          <View style={styles.searchRow}>
            <View style={styles.inputWithMic}>
              <TextInput
                ref={quickCodeRef}
                style={styles.inputInner}
                value={quickCode}
                onChangeText={(t) => setQuickCode(digitsOnly(t))}
                placeholder="Type last 3-10 digits"
                keyboardType={IS_WEB ? "default" : "number-pad"}
                returnKeyType="search"
                onSubmitEditing={handleQuickCodeSearch}
                onKeyPress={(e) => {
                  if (e.nativeEvent.key === "Enter") handleQuickCodeSearch();
                }}
                blurOnSubmit={false}
              />
              <ClearButton value={quickCode} onClear={() => setQuickCode("")} />
            </View>
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={handleQuickCodeSearch}
            >
              {searching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons name="magnify" size={22} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.quickHintBox}>
            <MaterialCommunityIcons
              name="lightning-bolt-outline"
              size={16}
              color={Colors.primary}
            />
            <Text style={styles.quickHintText}>
              Fast lookup by last digits. Example: 627866 can match 0101627866.
            </Text>
          </View>
          {quickCodeResults.length > 0 && (
            <ScrollView
              style={styles.nameResultsList}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {quickCodeResults.map((r) => (
                <TouchableOpacity
                  key={r.id || r.barcode}
                  style={styles.nameResultItem}
                  onPress={() => handleQuickCodeResultSelect(r)}
                >
                  <Text style={styles.nameResultCode}>{r.item_code}</Text>
                  <Text style={styles.nameResultName}>
                    {r.item_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {quickCodeResults.length === 0 &&
            quickCode.trim().length > 0 &&
            !searching &&
            !scanned && (
              <Text style={styles.nameHint}>
                No quick-code matches yet. Try more digits.
              </Text>
            )}
        </>
      );
    }
    // itemname mode
    return (
      <>
        <Text style={styles.label}>Item Name</Text>
        <View style={styles.searchRow}>
          <View style={styles.inputWithMic}>
            <TextInput
              ref={itemNameRef}
              style={styles.inputInner}
              value={itemName}
              onChangeText={(t) => setItemName(t.toUpperCase())}
              placeholder="Type part of item name..."
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={handleItemNameSearch}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === "Enter") handleItemNameSearch();
              }}
              blurOnSubmit={false}
            />
            <ClearButton value={itemName} onClear={() => setItemName("")} />
          </View>
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={handleItemNameSearch}
          >
            {searching ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons name="magnify" size={22} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
        {nameResults.length > 0 && (
          <ScrollView
            style={styles.nameResultsList}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {nameResults.map((r) => (
              <TouchableOpacity
                key={r.id || r.barcode}
                style={styles.nameResultItem}
                onPress={() => handleNameResultSelect(r)}
              >
                <Text style={styles.nameResultCode}>{r.item_code}</Text>
                <Text style={styles.nameResultName}>
                  {r.item_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {nameResults.length === 0 &&
          itemName.trim().length > 0 &&
          !searching &&
          !scanned && (
            <Text style={styles.nameHint}>
              Press search to find matching items
            </Text>
          )}
      </>
    );
  };

  const renderItemBanner = () => {
    if (!scanned) return null;
    const found = !!foundItem;
    return (
      <View
        style={[
          styles.itemBanner,
          { backgroundColor: found ? "#E8F5E9" : "#FFF8E1" },
        ]}
      >
        <MaterialCommunityIcons
          name={found ? "check-circle" : "alert-circle"}
          size={24}
          color={found ? Colors.success : "#F57F17"}
        />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text
            style={[
              styles.itemBannerTitle,
              { color: found ? "#2E7D32" : "#F57F17" },
            ]}
          >
            {found
              ? foundItem.item_name
              : "Item not found — will still be recorded"}
          </Text>
          {found && (
            <>
              <Text style={styles.itemBannerDetail}>
                <Text style={{ fontWeight: "700" }}>Code: </Text>
                {foundItem.item_code}
              </Text>
              <Text style={styles.itemBannerDetail}>
                <Text style={{ fontWeight: "700" }}>Barcode: </Text>
                {foundItem.barcode}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderBinQtyFields = () => (
    <>
      <Text style={styles.label}>From Bin</Text>
      <View style={styles.inputWithMic}>
        <TextInput
          ref={fromBinRef}
          style={styles.inputInner}
          value={frombin}
          onChangeText={uc(setFrombin)}
          placeholder="e.g. A-01"
          autoCapitalize="characters"
          returnKeyType="next"
          onSubmitEditing={() => toBinRef.current?.focus()}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === "Enter") toBinRef.current?.focus();
          }}
          blurOnSubmit={false}
        />
        <ClearButton value={frombin} onClear={() => setFrombin("")} />
      </View>

      <Text style={styles.label}>To Bin</Text>
      <View style={styles.inputWithMic}>
        <TextInput
          ref={toBinRef}
          style={styles.inputInner}
          value={tobin}
          onChangeText={uc(setTobin)}
          placeholder="e.g. B-03"
          autoCapitalize="characters"
          returnKeyType="next"
          onSubmitEditing={() => qtyRef.current?.focus()}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === "Enter") qtyRef.current?.focus();
          }}
          blurOnSubmit={false}
        />
        <ClearButton value={tobin} onClear={() => setTobin("")} />
      </View>

      <Text style={styles.label}>
        Quantity{" "}
        <Text
          style={{ fontWeight: "400", color: Colors.textLight, fontSize: 11 }}
        >
          (tap calculator for math: 3×48 = 144)
        </Text>
      </Text>
      <CalcInput
        ref={qtyRef}
        value={qty}
        onValueChange={setQty}
        placeholder="Qty — tap to open calculator"
        onSubmitEditing={handleSave}
      />

      <Text style={styles.label}>
        Notes{" "}
        <Text style={{ fontWeight: "400", color: Colors.textLight }}>
          (optional)
        </Text>
      </Text>
      <View style={styles.inputWithMic}>
        <TextInput
          ref={notesRef}
          style={styles.inputInner}
          value={notes}
          onChangeText={uc(setNotes)}
          placeholder="e.g. DAMAGE, EXPIRY 2026-12"
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={handleSave}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === "Enter") handleSave();
          }}
        />
        <ClearButton value={notes} onClear={() => setNotes("")} />
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <MaterialCommunityIcons name="content-save" size={22} color="#fff" />
        )}
        <Text style={styles.saveBtnText}>
          {saving ? "Saving..." : "Save Transaction"}
        </Text>
      </TouchableOpacity>

      {lastSaved && (
        <View style={styles.lastSavedBanner}>
          <MaterialCommunityIcons
            name="check-circle"
            size={16}
            color={Colors.success}
          />
          <Text style={styles.lastSavedText} numberOfLines={1}>
            Saved: {lastSaved.name} | Qty {lastSaved.qty} | {lastSaved.from} to{" "}
            {lastSaved.to}
          </Text>
        </View>
      )}
    </>
  );

  // ─── Web version ──────────────────────────────────────────────────────────
  if (IS_WEB) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          style={styles.container}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
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
  if (!permission)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons
          name="camera-off"
          size={48}
          color={Colors.textLight}
        />
        <Text style={styles.permText}>
          Camera permission is required for scanning.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Native ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "#0D47A1" }}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.container}>
          {renderTabs()}

          {isFocused &&
            (mode === "barcode" || mode === "itemcode") &&
            showCamera &&
            cameraActive && (
              <View style={styles.cameraWrap}>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  onBarcodeScanned={
                    scanned
                      ? undefined
                      : mode === "itemcode"
                        ? handleItemCodeScanned
                        : handleBarCodeScanned
                  }
                  enableTorch={torchOn}
                  barcodeScannerSettings={{
                    barcodeTypes:
                      mode === "itemcode"
                        ? [
                            "qr",
                            "code128",
                            "code39",
                            "datamatrix",
                            "codabar",
                            "itf14",
                          ]
                        : [
                            "qr",
                            "ean13",
                            "ean8",
                            "code128",
                            "code39",
                            "upc_a",
                            "upc_e",
                            "itf14",
                            "codabar",
                          ],
                  }}
                />
                <View style={styles.overlay}>
                  <View style={styles.overlayDark} />
                  <View style={styles.scanRow}>
                    <View style={styles.overlayDark} />
                    <View style={styles.scanFrame}>
                      <View style={[styles.corner, styles.cornerTL]} />
                      <View style={[styles.corner, styles.cornerTR]} />
                      <View style={[styles.corner, styles.cornerBL]} />
                      <View style={[styles.corner, styles.cornerBR]} />
                      <View style={styles.scanLine} />
                    </View>
                    <View style={styles.overlayDark} />
                  </View>
                  <View style={styles.overlayDark}>
                    <Text style={styles.scanHint}>
                      {mode === "itemcode"
                        ? "Point camera at item-code QR/barcode"
                        : "Point camera at barcode"}
                    </Text>
                    <TouchableOpacity
                      style={styles.torchBtn}
                      onPress={() => setTorchOn((v) => !v)}
                    >
                      <MaterialCommunityIcons
                        name={torchOn ? "flashlight-off" : "flashlight"}
                        size={16}
                        color="#fff"
                      />
                      <Text style={styles.torchBtnText}>
                        {torchOn ? "Torch Off" : "Torch On"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

          <ScrollView
            style={styles.form}
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {!showCamera && (mode === "barcode" || mode === "itemcode") && (
              <TouchableOpacity style={styles.rescanBtn} onPress={openScanner}>
                <MaterialCommunityIcons
                  name={scanned ? "camera-retake" : "barcode-scan"}
                  size={20}
                  color="#fff"
                />
                <Text style={styles.rescanText}>
                  {scanned
                    ? "Scan Again"
                    : mode === "barcode"
                      ? "Scan Barcode"
                      : "Scan Item Code"}
                </Text>
              </TouchableOpacity>
            )}
            {renderSearchInput()}
            {renderItemBanner()}
            {renderBinQtyFields()}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permText: {
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 16,
    fontSize: 15,
  },
  permBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  permBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  tabRow: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 12, fontWeight: "700", color: Colors.textSecondary },
  tabTextActive: { color: "#fff" },

  cameraWrap: { height: 240, overflow: "hidden", backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayDark: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanRow: { flexDirection: "row", height: 140 },
  scanFrame: { width: 260, height: 140, position: "relative" },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: "#00E676",
    borderWidth: 3,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 8,
  },
  scanLine: {
    position: "absolute",
    top: "50%",
    left: 10,
    right: 10,
    height: 2,
    backgroundColor: "#00E676",
    borderRadius: 1,
  },
  scanHint: { color: "#fff", fontWeight: "700", fontSize: 14, marginTop: 8 },
  torchBtn: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  torchBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  form: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  rescanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 8,
    elevation: 2,
  },
  rescanText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  label: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 4,
    marginTop: 12,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldRow: { flexDirection: "row", alignItems: "center" },
  inputWithMic: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  inputInner: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  micInside: {
    marginRight: 8,
    backgroundColor: "transparent",
  },
  searchBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    padding: 12,
    marginLeft: 6,
    elevation: 2,
  },

  itemBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    elevation: 1,
  },
  itemBannerTitle: { fontSize: 15, fontWeight: "800" },
  itemBannerDetail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  nameResultsList: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    marginTop: 6,
    overflow: "hidden",
    backgroundColor: Colors.card,
    maxHeight: 260,
  },
  nameResultItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  nameResultCode: { fontSize: 12, fontWeight: "800", color: Colors.primary },
  nameResultName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginTop: 1,
  },
  nameHint: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 8,
    textAlign: "center",
  },
  quickHintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary + "10",
  },
  quickHintText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    fontWeight: "600",
  },

  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 24,
    marginBottom: 8,
    elevation: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    gap: 10,
  },
  saveBtnDisabled: { backgroundColor: Colors.textLight, elevation: 0 },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },

  lastSavedBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.success + "15",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    gap: 8,
  },
  lastSavedText: {
    flex: 1,
    fontSize: 12,
    color: Colors.success,
    fontWeight: "600",
  },
});
