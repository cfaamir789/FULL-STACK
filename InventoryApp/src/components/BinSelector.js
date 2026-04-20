/**
 * BinSelector — smart bin selection component used in ScannerScreen.
 *
 * Two modes:
 *   "suggest" — shows autocomplete list of bins that have stock for the item.
 *               User types to filter, taps a row to select.
 *   "custom"  — free-text input (no validation against system bins).
 *               Used for un-GRN'd goods / new bins not yet in the system.
 *
 * Props:
 *   label             string   — e.g. "From Bin" / "To Bin"
 *   placeholder       string   — input placeholder in custom mode
 *   bins              array    — [{ bin_code, qty }]  (from local DB)
 *   mode              string   — "suggest" | "custom"
 *   onModeChange      fn(mode) — called when user switches modes
 *   selectedBin       object   — { bin_code, qty } or null (suggest mode)
 *   onSelectBin       fn(bin)  — called when user picks a bin from list
 *   customValue       string   — value of the free-text input (custom mode)
 *   onCustomChange    fn(text) — onChange for free-text input (custom mode)
 *   inputRef          ref      — forwarded ref for the custom text input
 *   onSubmitEditing   fn       — called when user presses enter/next
 *   editable          bool     — disable inputs when no item scanned yet
 */
import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

export default function BinSelector({
  label,
  placeholder = "e.g. A10101A",
  bins = [],
  mode,
  onModeChange,
  selectedBin,
  onSelectBin,
  customValue = "",
  onCustomChange,
  inputRef,
  onSubmitEditing,
  editable = true,
  onBinValidate, // async (binCode) => bool — returns true if bin exists in master
  showQty = true, // false hides qty badges/counts (e.g. for workers)
}) {
  const [filterText, setFilterText] = useState("");
  const [listOpen, setListOpen] = useState(bins.length > 0);
  const [customError, setCustomError] = useState(""); // inline red error for custom mode

  // Auto-open the list whenever a new item is scanned and bins change
  useEffect(() => {
    setListOpen(bins.length > 0);
  }, [bins.length]);

  // Filter the bins list based on what the user types in the autocomplete input
  const filteredBins = useMemo(() => {
    if (!filterText.trim()) return bins;
    const q = filterText.trim().toUpperCase();
    return bins.filter((b) => b.bin_code.includes(q));
  }, [bins, filterText]);

  // Smart match: if customValue exactly equals a known bin, confirm it with green tick
  const matchedBin = useMemo(() => {
    if (!customValue || bins.length === 0) return null;
    return (
      bins.find((b) => b.bin_code === customValue.trim().toUpperCase()) || null
    );
  }, [customValue, bins]);

  const handleSelectBin = (bin) => {
    onSelectBin(bin);
    setFilterText(bin.bin_code);
    setListOpen(false);
  };

  const handleSwitchToCustom = () => {
    onModeChange("custom");
    setFilterText("");
    setListOpen(false);
    // forward the typed filter text as the initial custom value
    if (filterText.trim() && onCustomChange) {
      onCustomChange(filterText.trim().toUpperCase());
    }
  };

  const handleSwitchToSuggest = () => {
    onModeChange("suggest");
    setFilterText(customValue || "");
    setListOpen(false);
  };

  const handleFilterChange = (text) => {
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setFilterText(upper);
    setListOpen(true);
    // Clear the selection when user modifies the filter text
    if (selectedBin && upper !== selectedBin.bin_code) {
      onSelectBin(null);
    }
  };

  // Custom-mode: validate bin on submit (real-time hard block)
  const handleCustomSubmit = async () => {
    if (onBinValidate && customValue.trim()) {
      const code = customValue.trim().toUpperCase();
      const exists = await onBinValidate(code);
      if (!exists) {
        setCustomError(`❌ Bin "${code}" not found in master — cleared`);
        onCustomChange("");
        return; // do NOT advance to next field
      }
    }
    setCustomError("");
    if (onSubmitEditing) onSubmitEditing();
  };

  // Clear error as soon as user starts typing
  const handleCustomChange = (text) => {
    if (customError) setCustomError("");
    onCustomChange(text.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  };

  const isDisabled = !editable;
  const noBins = bins.length === 0;

  // ─── Suggest mode ──────────────────────────────────────────────────────────
  if (mode === "suggest") {
    // If no bins at all, show a non-blocking message and a Custom Bin shortcut
    if (noBins) {
      return (
        <View style={[styles.wrapper, isDisabled && styles.disabled]}>
          <Text style={[styles.label, isDisabled && { opacity: 0.5 }]}>
            {label}
          </Text>
          <View style={[styles.noStockBox]}>
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={Colors.textSecondary}
            />
            <Text style={styles.noStockText}>
              No bin stock records for this item.
            </Text>
            <TouchableOpacity
              onPress={handleSwitchToCustom}
              disabled={isDisabled}
            >
              <Text style={styles.switchLink}>Use Custom Bin</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.wrapper, isDisabled && styles.disabled]}>
        <Text style={[styles.label, isDisabled && { opacity: 0.5 }]}>
          {label}
        </Text>

        {/* Selected bin chip */}
        {selectedBin ? (
          <View style={styles.selectedChip}>
            <MaterialCommunityIcons
              name="warehouse"
              size={18}
              color={Colors.success}
            />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.chipBinCode}>{selectedBin.bin_code}</Text>
              {showQty && (
                <Text style={styles.chipQty}>
                  Available: {selectedBin.qty.toLocaleString()} pcs
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => {
                onSelectBin(null);
                setFilterText("");
                setListOpen(true);
              }}
              disabled={isDisabled}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={22}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Autocomplete search input */}
            <View
              style={[
                styles.inputBox,
                listOpen && styles.inputBoxFocused,
                isDisabled && { opacity: 0.5 },
              ]}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={18}
                color={Colors.textSecondary}
                style={{ marginRight: 6 }}
              />
              <TextInput
                style={styles.filterInput}
                value={filterText}
                onChangeText={handleFilterChange}
                placeholder={`Search or type bin code (${bins.length} bins)`}
                placeholderTextColor={Colors.textLight}
                autoCapitalize="characters"
                returnKeyType="next"
                onFocus={() => setListOpen(true)}
                onSubmitEditing={onSubmitEditing}
                editable={!isDisabled}
              />
              {filterText.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setFilterText("");
                    setListOpen(true);
                    onSelectBin(null);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={20}
                    color={Colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Bin list dropdown */}
            {listOpen && (
              <View style={styles.dropdown}>
                <ScrollView
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 220 }}
                >
                  {filteredBins.length === 0 ? (
                    <Text style={styles.emptyMsg}>
                      No matching bins — try Custom Bin below.
                    </Text>
                  ) : (
                    filteredBins.map((b) => (
                      <TouchableOpacity
                        key={b.bin_code}
                        style={styles.binRow}
                        onPress={() => handleSelectBin(b)}
                      >
                        <MaterialCommunityIcons
                          name="warehouse"
                          size={16}
                          color={Colors.primary}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.binRowCode}>{b.bin_code}</Text>
                        {showQty && (
                          <View style={styles.qtyBadge}>
                            <Text style={styles.qtyBadgeText}>
                              {b.qty.toLocaleString()} pcs
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>

                {/* Custom Bin option at bottom of dropdown */}
                <TouchableOpacity
                  style={styles.customBinOption}
                  onPress={handleSwitchToCustom}
                >
                  <MaterialCommunityIcons
                    name="pencil-plus"
                    size={16}
                    color={Colors.warning}
                  />
                  <Text style={styles.customBinOptionText}>
                    Use Custom Bin (not in system)
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Close dropdown tap-outside area hint */}
            {!listOpen && (
              <TouchableOpacity
                style={styles.showListBtn}
                onPress={() => setListOpen(true)}
                disabled={isDisabled}
              >
                <MaterialCommunityIcons
                  name="chevron-down"
                  size={16}
                  color={Colors.primary}
                />
                <Text style={styles.showListBtnText}>
                  Show {bins.length} bin{bins.length !== 1 ? "s" : ""} with
                  stock
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Switch to Custom Bin link */}
        <TouchableOpacity
          onPress={handleSwitchToCustom}
          disabled={isDisabled}
          style={styles.modeSwitchRow}
        >
          <MaterialCommunityIcons
            name="pencil-outline"
            size={14}
            color={Colors.warning}
          />
          <Text style={styles.modeSwitchText}>Switch to Custom Bin</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Custom mode ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.wrapper, isDisabled && styles.disabled]}>
      <Text style={[styles.label, isDisabled && { opacity: 0.5 }]}>
        {label}
      </Text>

      {/* Quick-select chips — shown when bins exist and no exact match yet */}
      {bins.length > 0 && !matchedBin && (
        <View style={styles.quickSelectRow}>
          <Text style={styles.quickSelectLabel}>Quick select:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {bins.map((b) => (
              <TouchableOpacity
                key={b.bin_code}
                style={styles.quickChip}
                onPress={() => onCustomChange(b.bin_code)}
                disabled={isDisabled}
              >
                <Text style={styles.quickChipCode}>{b.bin_code}</Text>
                <Text style={styles.quickChipQty}>
                  {b.qty.toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Green confirmed chip when typed bin exactly matches a stocked bin */}
      {matchedBin ? (
        <View style={styles.selectedChip}>
          <MaterialCommunityIcons
            name="check-circle"
            size={18}
            color={Colors.success}
          />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.chipBinCode}>{matchedBin.bin_code}</Text>
            <Text style={styles.chipQty}>
              Available: {matchedBin.qty.toLocaleString()} pcs
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => onCustomChange("")}
            disabled={isDisabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={22}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Custom bin banner — only shown when no stock match */}
          <View style={styles.customBanner}>
            <MaterialCommunityIcons
              name="pencil-circle"
              size={16}
              color={Colors.warning}
            />
            <Text style={styles.customBannerText}>
              Custom bin — no stock validation (use for un-GRN'd goods)
            </Text>
          </View>

          {/* Free-text input */}
          <View
            style={[
              styles.inputBox,
              customError ? styles.inputBoxError : null,
              isDisabled && { opacity: 0.5 },
            ]}
          >
            <TextInput
              ref={inputRef}
              style={styles.filterInput}
              value={customValue}
              onChangeText={handleCustomChange}
              placeholder={placeholder}
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
              returnKeyType="next"
              onSubmitEditing={handleCustomSubmit}
              editable={!isDisabled}
            />
            {customValue.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setCustomError("");
                  onCustomChange("");
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={20}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
          {/* Inline validation error */}
          {customError ? (
            <View style={styles.binErrorRow}>
              <MaterialCommunityIcons
                name="alert-circle"
                size={14}
                color="#c62828"
              />
              <Text style={styles.binErrorText}>{customError}</Text>
            </View>
          ) : null}
        </>
      )}

      {/* Back to suggestions link */}
      {bins.length > 0 && (
        <TouchableOpacity
          onPress={handleSwitchToSuggest}
          disabled={isDisabled}
          style={styles.modeSwitchRow}
        >
          <MaterialCommunityIcons
            name="warehouse"
            size={14}
            color={Colors.primary}
          />
          <Text style={[styles.modeSwitchText, { color: Colors.primary }]}>
            Back to suggestions ({bins.length} bin{bins.length !== 1 ? "s" : ""}{" "}
            with stock)
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 12 },
  disabled: { opacity: 0.5 },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  inputBoxFocused: {
    borderColor: Colors.primary,
  },
  inputBoxError: {
    borderColor: "#c62828",
    backgroundColor: "#fff5f5",
  },
  binErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  binErrorText: {
    fontSize: 12,
    color: "#c62828",
    fontWeight: "600",
    flex: 1,
  },
  filterInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  dropdown: {
    marginTop: 2,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary + "40",
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    zIndex: 100,
  },
  binRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  binRowCode: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  qtyBadge: {
    backgroundColor: Colors.primary + "15",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  qtyBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primary,
  },
  customBinOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: Colors.warning + "12",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  customBinOptionText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.warning,
  },
  emptyMsg: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    padding: 14,
  },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.success + "15",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.success + "40",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipBinCode: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  chipQty: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.success,
    marginTop: 1,
  },
  showListBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  showListBtnText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "600",
  },
  modeSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  modeSwitchText: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: "600",
  },
  customBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.warning + "12",
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  customBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: Colors.warning,
  },
  noStockBox: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    backgroundColor: Colors.border + "50",
    borderRadius: 8,
    padding: 10,
  },
  noStockText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  switchLink: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.warning,
    textDecorationLine: "underline",
  },
  quickSelectRow: {
    marginBottom: 8,
  },
  quickSelectLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.primary + "12",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginRight: 6,
    borderWidth: 1.5,
    borderColor: Colors.primary + "30",
  },
  quickChipCode: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.primary,
  },
  quickChipQty: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
});
