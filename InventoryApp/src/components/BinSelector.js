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
import React, { useState, useMemo, useEffect, useRef, useImperativeHandle } from "react";
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
  allowedCustomBins, // string[] — if set, only these bin codes are accepted in custom mode
}) {
  const [filterText, setFilterText] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [customError, setCustomError] = useState(""); // inline red error for custom mode

  // Internal ref for the actual TextInput
  const internalInputRef = useRef(null);
  // Tracks the pending onBlur close-timer so it can be cancelled on re-focus
  const blurTimerRef = useRef(null);

  // Intercept the external ref so ScannerScreen's programmatic .focus()
  // also opens the dropdown (Android doesn't fire onFocus on programmatic focus)
  useImperativeHandle(inputRef, () => ({
    focus: () => {
      // Cancel any pending onBlur close-timer before opening — prevents the
      // stale timer from closing the dropdown after we open it
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      internalInputRef.current?.focus();
      setListOpen(true);
    },
    blur: () => {
      // Don't close list here — let the TextInput's own onBlur handle it
      internalInputRef.current?.blur();
    },
    openList: () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      setListOpen(true);
    },
  }));

  // Reset internal state whenever bins are cleared (item X'd or tab switched)
  // Do NOT auto-open the list here — it opens only when the input is focused
  useEffect(() => {
    if (bins.length === 0) {
      setFilterText("");
      setListOpen(false);
      setCustomError("");
    }
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

  // Treat value as confirmed if it's the only allowed custom bin (even with no stock)
  const isConfirmedAllowed = useMemo(() => {
    if (!customValue || !allowedCustomBins || allowedCustomBins.length === 0)
      return false;
    return allowedCustomBins.includes(customValue.trim().toUpperCase());
  }, [customValue, allowedCustomBins]);

  const handleSelectBin = (bin) => {
    // Cancel the pending onBlur close-timer immediately — on slow Android devices
    // the onPress fires AFTER 150ms, by which time the dropdown has closed and
    // the touch event is lost. Cancelling here guarantees the selection sticks.
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    onSelectBin(bin);
    setFilterText(bin.bin_code);
    setListOpen(false);
    // NOTE: do NOT call onSubmitEditing here.
    // The parent's onSelectBin prop already handles focus-to-next-field.
    // Calling it here too creates competing focus calls that crash Android IME.
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
    // Shortcut: typing "IN0001" fully auto-selects — partial "IN" only pre-filters
    if (upper === "IN0001") {
      const in0001 = bins.find((b) => b.bin_code === "IN0001");
      if (in0001) {
        handleSelectBin(in0001);
        return;
      }
      // IN0001 not in suggest bins — switch to confirmed custom value, no auto-advance
      if (allowedCustomBins && allowedCustomBins.includes("IN0001")) {
        onModeChange("custom");
        if (onCustomChange) onCustomChange("IN0001");
        setFilterText("");
        setListOpen(false);
        return;
      }
    }
    // Auto-switch to custom mode when typed text matches no bins
    if (upper.length > 0) {
      const matches = bins.filter((b) => b.bin_code.includes(upper));
      if (matches.length === 0) {
        onModeChange("custom");
        if (onCustomChange) onCustomChange(upper);
        setFilterText("");
        setListOpen(false);
      }
    }
  };

  // Custom-mode: validate bin on submit (real-time hard block)
  const handleCustomSubmit = async () => {
    const code = customValue.trim().toUpperCase();
    // Pre-approved bins (e.g. IN0001) skip master validation
    if (allowedCustomBins && allowedCustomBins.includes(code)) {
      setCustomError("");
      if (onSubmitEditing) onSubmitEditing();
      return;
    }
    if (onBinValidate && code) {
      const exists = await onBinValidate(code);
      if (!exists) {
        setCustomError(`❌ Bin "${code}" not found in master — cleared`);
        onCustomChange("");
        return;
      }
    }
    setCustomError("");
    if (onSubmitEditing) onSubmitEditing();
  };

  // Clear error as soon as user starts typing
  const handleCustomChange = (text) => {
    if (customError) setCustomError("");
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // "IN" shortcut → auto-fill IN0001 (works in custom mode)
    if (upper === "IN") {
      onCustomChange("IN0001");
      return;
    }
    onCustomChange(upper);
  };

  const isDisabled = !editable;
  const noBins = bins.length === 0;

  // ─── Suggest mode ──────────────────────────────────────────────────────────
  if (mode === "suggest") {
    // If no bins at all, show a non-blocking message and a Custom Bin shortcut
    if (noBins) {
      return (
        <View style={[styles.wrapper, isDisabled && styles.disabled]}>
          <View style={styles.headerRow}>
            <Text style={[styles.label, isDisabled && { opacity: 0.5 }]}>
              {label}
            </Text>
            <View style={[styles.noStockBox, { flex: 1 }]}>
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
        </View>
      );
    }

    return (
      <View style={[styles.wrapper, isDisabled && styles.disabled]}>
        {/* Label + input/chip on same row */}
        <View style={styles.headerRow}>
          <Text style={[styles.label, isDisabled && { opacity: 0.5 }]}>
            {label}
          </Text>

          {/* Selected bin chip or search input — inline with label */}
          {selectedBin ? (
            <View style={[styles.selectedChip, { flex: 1 }]}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                onPress={() => onSubmitEditing?.()}
                disabled={isDisabled}
              >
                <MaterialCommunityIcons
                  name="check-circle"
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
              </TouchableOpacity>
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
            <View
              style={[
                styles.inputBox,
                listOpen && styles.inputBoxFocused,
                isDisabled && { opacity: 0.5 },
                { flex: 1 },
              ]}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={18}
                color={Colors.textSecondary}
                style={{ marginRight: 6 }}
              />
              <TextInput
                ref={internalInputRef}
                style={styles.filterInput}
                value={filterText}
                onChangeText={handleFilterChange}
                placeholder={`Search or type bin code (${bins.length} bins)`}
                placeholderTextColor={Colors.textLight}
                autoCapitalize="characters"
                keyboardType="default"
                returnKeyType="next"
                showSoftInputOnFocus={true}
                onFocus={() => {
                  if (blurTimerRef.current) {
                    clearTimeout(blurTimerRef.current);
                    blurTimerRef.current = null;
                  }
                  setListOpen(true);
                }}
                onBlur={() => {
                  blurTimerRef.current = setTimeout(() => setListOpen(false), 300);
                }}
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
          )}
        </View>

        {/* Bin list dropdown — below the header row */}
        {!selectedBin && listOpen && (
          <View style={styles.dropdown}>
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 132 }}
            >
              {filteredBins.length === 0 ? (
                <Text style={styles.emptyMsg}>
                  No matching bins.
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
          </View>
        )}

        {/* Show bins button when dropdown closed */}
        {!selectedBin && !listOpen && (
          <TouchableOpacity
            style={styles.showListBtn}
            onPress={() => setListOpen(true)}
            disabled={isDisabled}
          >
            <MaterialCommunityIcons
              name="chevron-down"
              size={14}
              color={Colors.primary}
            />
            <Text style={styles.showListBtnText}>
              Show {bins.length} bin{bins.length !== 1 ? "s" : ""} with stock
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ─── Custom mode ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.wrapper, isDisabled && styles.disabled]}>
      {/* Label + input/chip on same row */}
      <View style={styles.headerRow}>
        <Text style={[styles.label, isDisabled && { opacity: 0.5 }]}>
          {label}
        </Text>

        {/* Green confirmed chip or free-text input — inline with label */}
        {matchedBin || isConfirmedAllowed ? (
          <View style={[styles.selectedChip, { flex: 1 }]}>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
              onPress={() => onSubmitEditing?.()}
              disabled={isDisabled}
            >
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={Colors.success}
              />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.chipBinCode}>
                  {matchedBin
                    ? matchedBin.bin_code
                    : customValue.trim().toUpperCase()}
                </Text>
                {showQty && matchedBin && (
                  <Text style={styles.chipQty}>
                    Available: {matchedBin.qty.toLocaleString()} pcs
                  </Text>
                )}
              </View>
            </TouchableOpacity>
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
          <View
            style={[
              styles.inputBox,
              customError ? styles.inputBoxError : null,
              isDisabled && { opacity: 0.5 },
              { flex: 1 },
            ]}
          >
            <TextInput
              ref={internalInputRef}
              style={styles.filterInput}
              value={customValue}
              onChangeText={handleCustomChange}
              placeholder={placeholder}
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
              keyboardType="default"
              returnKeyType="next"
              showSoftInputOnFocus={true}
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
        )}
      </View>

      {/* Inline validation error — below the row */}
      {!(matchedBin || isConfirmedAllowed) && customError ? (
        <View style={styles.binErrorRow}>
          <MaterialCommunityIcons
            name="alert-circle"
            size={14}
            color="#c62828"
          />
          <Text style={styles.binErrorText}>{customError}</Text>
        </View>
      ) : null}

      {/* Back to suggestions link */}
      {bins.length > 0 && (
        <TouchableOpacity
          onPress={handleSwitchToSuggest}
          disabled={isDisabled}
          style={styles.modeSwitchRow}
        >
          <MaterialCommunityIcons
            name="warehouse"
            size={12}
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
  wrapper: { marginTop: 6 },
  disabled: { opacity: 0.5 },
  label: {
    width: 72,
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: 0.3,
    flexShrink: 0,
    marginRight: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
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
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  dropdown: {
    marginTop: 4,
    marginLeft: 80,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary + "50",
    overflow: "hidden",
    elevation: 6,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    zIndex: 100,
  },
  binRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + "80",
  },
  binRowCode: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
    letterSpacing: 0.4,
  },
  qtyBadge: {
    backgroundColor: Colors.primary + "18",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
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
    gap: 3,
    marginTop: 2,
    marginLeft: 80,
  },
  showListBtnText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: "600",
  },
  modeSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  modeSwitchText: {
    fontSize: 11,
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
