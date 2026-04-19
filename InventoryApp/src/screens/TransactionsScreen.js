import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Text,
  Alert,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAllTransactions,
  getPendingTransactions,
  getTransactionsCount,
  getTransactionsPage,
  updateTransaction,
  deleteTransaction,
} from "../database/db";
import {
  getServerTransactions,
  getAllServerTransactions,
  checkHealth,
} from "../services/api";
import { setDataClearedListener } from "../services/syncService";
import TransactionRow from "../components/TransactionRow";
import VoiceMic from "../components/VoiceMic";
import CalcInput from "../components/CalcInput";
import Colors from "../theme/colors";
import { isAdminRole } from "../utils/roles";
import {
  isTransactionOwnedByUser,
  mapServerTransactionToLocalShape,
  mergeTransactions,
} from "../utils/transactions";

const IS_WEB = Platform.OS === "web";
let backupSvc = null;
if (!IS_WEB) {
  backupSvc = require("../services/backupService");
}

const PAGE_SIZE = 150;
const ADMIN_PAGE_SIZE = 200;

const filterTransactionList = (rows, workerFilter, searchText) => {
  let result = rows;
  if (workerFilter !== "all") {
    result = result.filter(
      (tx) => (tx.worker_name || "unknown") === workerFilter,
    );
  }

  if (searchText.trim()) {
    const query = searchText.trim().toLowerCase();
    result = result.filter(
      (tx) =>
        (tx.item_code && tx.item_code.toLowerCase().includes(query)) ||
        (tx.item_barcode && tx.item_barcode.toLowerCase().includes(query)) ||
        (tx.item_name && tx.item_name.toLowerCase().includes(query)) ||
        (tx.worker_name && tx.worker_name.toLowerCase().includes(query)) ||
        (tx.erp_document && tx.erp_document.toLowerCase().includes(query)) ||
        (tx.erp_batch && tx.erp_batch.toLowerCase().includes(query)),
    );
  }

  return result;
};

export default function TransactionsScreen({ username, role, scope = "self" }) {
  const queryRef = useRef(null);
  const searchTimerRef = useRef(null);
  const lastLoadedAtRef = useRef(0);
  const paginationRef = useRef({
    mode: "idle",
    nextPage: 1,
    total: 0,
    primaryRows: [],
    supplementRows: [],
  });
  const canManageAll = isAdminRole(role) && scope === "all";
  const pageSize = canManageAll ? ADMIN_PAGE_SIZE : PAGE_SIZE;
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [exporting, setExporting] = useState(false);

  // Get unique worker names for filter chips
  const workerNames = useMemo(
    () =>
      canManageAll
        ? [
            ...new Set(
              transactions
                .map((tx) => tx.worker_name || "unknown")
                .filter(Boolean),
            ),
          ]
        : [],
    [canManageAll, transactions],
  );

  const filtered = useMemo(() => {
    return filterTransactionList(transactions, workerFilter, debouncedQuery);
  }, [transactions, workerFilter, debouncedQuery]);

  // Edit modal state
  const [editItem, setEditItem] = useState(null);
  const [editFrombin, setEditFrombin] = useState("");
  const [editTobin, setEditTobin] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");

  // Delete modal state
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const applyPagedRows = useCallback((meta) => {
    paginationRef.current = meta;
    const nextRows =
      meta.mode === "server"
        ? mergeTransactions(meta.primaryRows, meta.supplementRows)
        : meta.primaryRows;
    setTransactions(nextRows);
    setHasMore(meta.primaryRows.length < meta.total);
  }, []);

  const loadServerPage = useCallback(
    async (page) => {
      if (scope === "all" && canManageAll) {
        return await getServerTransactions(page, pageSize, "pending");
      }

      return await getServerTransactions(page, pageSize, "all", {
        mine: true,
      });
    },
    [canManageAll, pageSize, scope],
  );

  const loadLocalPage = useCallback(async () => {
    const workerName = scope === "self" ? username : "";
    const offset = paginationRef.current.primaryRows.length;
    const [rows, total] = await Promise.all([
      getTransactionsPage(pageSize, offset, workerName),
      getTransactionsCount(workerName),
    ]);
    return { rows, total };
  }, [pageSize, scope, username]);

  const loadAllServerRows = useCallback(async (status, options = {}) => {
    let page = 1;
    let total = 0;
    const rows = [];

    while (page <= 100) {
      const data = await getServerTransactions(page, 250, status, options);
      const batch = data.transactions || [];
      total = Number(data.total || 0);
      rows.push(...batch);

      if (batch.length === 0 || rows.length >= total) {
        break;
      }
      page += 1;
    }

    return rows;
  }, []);

  const getTransactionsForExport = useCallback(async () => {
    if (paginationRef.current.mode === "server") {
      if (scope === "all" && canManageAll) {
        const serverRows = await loadAllServerRows("pending");
        const mappedRows = serverRows.map(mapServerTransactionToLocalShape);
        return filterTransactionList(mappedRows, workerFilter, debouncedQuery);
      }

      const [serverRes, localPendingAll] = await Promise.all([
        getAllServerTransactions({
          status: "all",
          mine: true,
          pageSize: 250,
          maxPages: 100,
        }),
        getPendingTransactions(username),
      ]);
      const localPending = localPendingAll.filter((tx) =>
        isTransactionOwnedByUser(tx, username),
      );
      const mappedRows = (serverRes.transactions || []).map(
        mapServerTransactionToLocalShape,
      );
      return filterTransactionList(
        mergeTransactions(mappedRows, localPending),
        workerFilter,
        debouncedQuery,
      );
    }

    const localRows = await getAllTransactions();
    const scopedRows =
      scope === "self"
        ? localRows.filter((tx) => isTransactionOwnedByUser(tx, username))
        : localRows;
    return filterTransactionList(scopedRows, workerFilter, debouncedQuery);
  }, [
    canManageAll,
    debouncedQuery,
    loadAllServerRows,
    scope,
    username,
    workerFilter,
  ]);

  // ─── Export handler ─────────────────────────────────────────────────────────
  const handleExportByFormat = async (format = "csv") => {
    setExporting(true);
    try {
      // Fetch the full dataset on demand so screen pagination stays fast
      // without changing export accuracy.
      const txns = await getTransactionsForExport();
      if (!txns || txns.length === 0) {
        Alert.alert("No Data", "No transactions to export.");
        return;
      }

      const worker =
        (await AsyncStorage.getItem("workerName")) || username || "worker";
      const datePart = new Date().toISOString().slice(0, 10);
      const baseName = `${worker}_${datePart}`;

      if (IS_WEB) {
        if (format === "xlsx") {
          const XLSX = require("xlsx");
          const rows = txns.map((tx) => ({
            Worker: tx.worker_name || "",
            Date: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "",
            Barcode: tx.item_barcode || "",
            ItemCode: tx.item_code || "",
            ItemName: tx.item_name || "",
            From: tx.frombin || "",
            To: tx.tobin || "",
            Qty: tx.qty ?? "",
            Notes: tx.notes || "",
            Synced: tx.synced ? "Yes" : "No",
          }));
          const ws = XLSX.utils.json_to_sheet(rows);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Transactions");
          const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
          const blob = new Blob([out], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${baseName}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          const header =
            "Worker,Date,Barcode,ItemCode,ItemName,From,To,Qty,Notes,Synced";
          const rows = txns.map((tx) =>
            [
              tx.worker_name || "",
              tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "",
              tx.item_barcode || "",
              tx.item_code || "",
              `"${(tx.item_name || "").replace(/"/g, '""')}"`,
              tx.frombin || "",
              tx.tobin || "",
              tx.qty ?? "",
              `"${(tx.notes || "").replace(/"/g, '""')}"`,
              tx.synced ? "Yes" : "No",
            ].join(","),
          );
          const csv = [header, ...rows].join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${baseName}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        Alert.alert(
          "Exported",
          `${txns.length} transactions downloaded as ${format.toUpperCase()}.`,
        );
      } else {
        const { filename, location } = await backupSvc.saveBackup(
          txns,
          worker,
          format,
          false,
        );
        Alert.alert(
          "Exported",
          `${txns.length} transactions saved as ${format.toUpperCase()}.\n\nFile: ${filename}\nSaved to: ${location}`,
        );
      }
    } catch (err) {
      Alert.alert("Export Failed", err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () => {
    if (exporting) return;
    Alert.alert("Export Transactions", "Choose format", [
      { text: "CSV", onPress: () => handleExportByFormat("csv") },
      { text: "XLSX", onPress: () => handleExportByFormat("xlsx") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      if (scope === "all" && canManageAll) {
        try {
          await checkHealth();
          const serverRes = await loadServerPage(1);
          const serverTxs = (serverRes.transactions || []).map(
            mapServerTransactionToLocalShape,
          );
          applyPagedRows({
            mode: "server",
            nextPage: 2,
            total: Number(serverRes.total || serverTxs.length),
            primaryRows: serverTxs,
            supplementRows: [],
          });
        } catch {
          const [rows, total] = await Promise.all([
            getTransactionsPage(pageSize, 0),
            getTransactionsCount(),
          ]);
          applyPagedRows({
            mode: "local",
            nextPage: 1,
            total,
            primaryRows: rows,
            supplementRows: [],
          });
        }
      } else {
        const localPending = await getPendingTransactions(username);

        try {
          await checkHealth();
          const serverRes = await loadServerPage(1);
          const serverTxs = (serverRes.transactions || []).map(
            mapServerTransactionToLocalShape,
          );
          applyPagedRows({
            mode: "server",
            nextPage: 2,
            total: Number(serverRes.total || serverTxs.length),
            primaryRows: serverTxs,
            supplementRows: localPending,
          });
        } catch {
          const [rows, total] = await Promise.all([
            getTransactionsPage(pageSize, 0, username),
            getTransactionsCount(username),
          ]);
          applyPagedRows({
            mode: "local",
            nextPage: 1,
            total,
            primaryRows: rows,
            supplementRows: [],
          });
        }
      }
    } catch {
      setTransactions([]);
      setHasMore(false);
    }
    lastLoadedAtRef.current = Date.now();
    setLoading(false);
  }, [applyPagedRows, canManageAll, loadServerPage, pageSize, scope, username]);

  const loadMoreTransactions = useCallback(async () => {
    if (loading || loadingMore || !hasMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const meta = paginationRef.current;
      if (meta.mode === "server") {
        const serverRes = await loadServerPage(meta.nextPage);
        const batch = (serverRes.transactions || []).map(
          mapServerTransactionToLocalShape,
        );
        if (batch.length === 0) {
          setHasMore(false);
          return;
        }
        applyPagedRows({
          ...meta,
          nextPage: meta.nextPage + 1,
          total: Number(serverRes.total || meta.total),
          primaryRows: [...meta.primaryRows, ...batch],
        });
        return;
      }

      if (meta.mode === "local") {
        const { rows, total } = await loadLocalPage();
        if (rows.length === 0) {
          setHasMore(false);
          return;
        }
        applyPagedRows({
          ...meta,
          total,
          primaryRows: [...meta.primaryRows, ...rows],
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [
    applyPagedRows,
    hasMore,
    loadLocalPage,
    loadServerPage,
    loading,
    loadingMore,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (
        transactions.length === 0 ||
        Date.now() - lastLoadedAtRef.current > 20000
      ) {
        loadTransactions();
      }
    }, [loadTransactions, transactions.length]),
  );

  // Reload when admin clears phone data via background sync
  useEffect(() => {
    const unsub = setDataClearedListener(() => loadTransactions());
    return unsub;
  }, [loadTransactions]);

  const openEdit = (item) => {
    if (item._source === "server") {
      Alert.alert(
        "Cannot Edit",
        "Server transactions cannot be edited locally. Use the admin panel to manage them.",
      );
      return;
    }
    setEditItem(item);
    setEditFrombin(item.frombin);
    setEditTobin(item.tobin);
    setEditQty(String(item.qty));
    setEditNotes(item.notes || "");
  };

  const closeEdit = () => {
    setEditItem(null);
    setEditFrombin("");
    setEditTobin("");
    setEditQty("");
    setEditNotes("");
  };

  const handleSave = async () => {
    if (saving) return;
    const trimmedFrom = editFrombin.trim();
    const trimmedTo = editTobin.trim();
    const trimmedQty = editQty.trim();
    if (!trimmedFrom || !trimmedTo || !trimmedQty) {
      setValidationMsg("All fields are required.");
      return;
    }
    const qty = parseInt(trimmedQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setValidationMsg("Qty must be a positive number.");
      return;
    }
    setValidationMsg("");
    setSaving(true);
    try {
      await updateTransaction(
        editItem.id,
        {
          frombin: trimmedFrom,
          tobin: trimmedTo,
          qty,
          notes: editNotes.trim(),
        },
        username,
        role,
      );
      await loadTransactions();
      closeEdit();
    } catch (err) {
      setValidationMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (item) => {
    if (item._source === "server") {
      Alert.alert(
        "Cannot Delete",
        "Server transactions cannot be deleted locally. Use the admin panel to manage them.",
      );
      return;
    }
    setDeleteItem(item);
    setDeleteConfirmed(false);
  };

  const closeDelete = () => {
    setDeleteItem(null);
    setDeleteConfirmed(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirmed) return;
    setDeleting(true);
    try {
      await deleteTransaction(deleteItem.id, username, role);
      await loadTransactions();
    } catch (err) {
      Alert.alert("Error", err.message);
    } finally {
      setDeleting(false);
      closeDelete();
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar with voice */}
      <View style={styles.searchBar}>
        <MaterialCommunityIcons
          name="magnify"
          size={20}
          color={Colors.textSecondary}
          style={{ marginRight: 8 }}
        />
        <TextInput
          ref={queryRef}
          style={styles.searchInput}
          placeholder="Search by item code, barcode or name..."
          value={query}
          onChangeText={(t) => {
            const upper = t.toUpperCase();
            setQuery(upper);
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
            searchTimerRef.current = setTimeout(
              () => setDebouncedQuery(upper),
              250,
            );
          }}
          autoCapitalize="characters"
          clearButtonMode="never"
          returnKeyType="search"
        />
        <VoiceMic
          onResult={(t) => {
            setQuery(t);
            setDebouncedQuery(t);
          }}
          focusTargetRef={queryRef}
          size={18}
          style={{ backgroundColor: "transparent", marginRight: 2 }}
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setQuery("");
              setDebouncedQuery("");
            }}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color={Colors.textLight}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Worker filter chips (admin only) */}
      {canManageAll && workerNames.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.workerFilterBar}
          contentContainerStyle={styles.workerFilterContent}
        >
          <TouchableOpacity
            style={[
              styles.workerChip,
              workerFilter === "all" && styles.workerChipActive,
            ]}
            onPress={() => setWorkerFilter("all")}
          >
            <Text
              style={[
                styles.workerChipText,
                workerFilter === "all" && styles.workerChipTextActive,
              ]}
            >
              All Workers
            </Text>
          </TouchableOpacity>
          {workerNames.map((name) => (
            <TouchableOpacity
              key={name}
              style={[
                styles.workerChip,
                workerFilter === name && styles.workerChipActive,
              ]}
              onPress={() =>
                setWorkerFilter(workerFilter === name ? "all" : name)
              }
            >
              <MaterialCommunityIcons
                name="account"
                size={14}
                color={workerFilter === name ? "#fff" : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.workerChipText,
                  workerFilter === name && styles.workerChipTextActive,
                ]}
              >
                {name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {transactions.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name="history"
            size={48}
            color={Colors.textLight}
          />
          <Text style={styles.emptyText}>No transactions yet.</Text>
          <Text style={styles.emptySubText}>
            Scan a barcode on the Scanner tab to create one.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.countBar}>
            <View style={styles.countRow}>
              <Text style={styles.countText}>
                {query.trim()
                  ? `${filtered.length} of ${transactions.length} transactions`
                  : `${transactions.length} transaction${transactions.length !== 1 ? "s" : ""}`}
              </Text>
              {/* Export button */}
              <TouchableOpacity
                style={styles.exportBtn}
                onPress={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <MaterialCommunityIcons
                    name="download"
                    size={18}
                    color={Colors.primary}
                  />
                )}
                <Text style={styles.exportBtnText}>Export</Text>
              </TouchableOpacity>
            </View>
          </View>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="magnify-close"
                size={40}
                color={Colors.textLight}
              />
              <Text style={styles.emptyText}>No matches found</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <TransactionRow
                  item={item}
                  onEdit={openEdit}
                  onDelete={openDelete}
                  canEdit={
                    canManageAll ||
                    (item.worker_name === username && item.synced !== 1)
                  }
                  canDelete={
                    canManageAll ||
                    (item.worker_name === username && item.synced !== 1)
                  }
                />
              )}
              contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}
              initialNumToRender={15}
              maxToRenderPerBatch={15}
              windowSize={7}
              onEndReached={loadMoreTransactions}
              onEndReachedThreshold={0.45}
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator
                    color={Colors.primary}
                    style={{ marginTop: 10, marginBottom: 16 }}
                  />
                ) : null
              }
              removeClippedSubviews={Platform.OS !== "web"}
              getItemLayout={(_, index) => ({
                length: 120,
                offset: 120 * index,
                index,
              })}
            />
          )}
        </>
      )}

      {/* ── Edit Modal ── */}
      <Modal
        visible={!!editItem}
        transparent
        animationType="slide"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { justifyContent: "flex-end" }]}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalCard}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Transaction</Text>
              <TouchableOpacity onPress={closeEdit}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Read-only item info */}
              {editItem?.item_code && editItem.item_code.trim() !== "" ? (
                <View style={styles.readonlyBox}>
                  <MaterialCommunityIcons
                    name="identifier"
                    size={16}
                    color={Colors.textSecondary}
                  />
                  <Text style={styles.readonlyText}>
                    Item Code: {editItem.item_code}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.readonlyBox, { marginTop: 4 }]}>
                <MaterialCommunityIcons
                  name="package-variant"
                  size={16}
                  color={Colors.textSecondary}
                />
                <Text style={styles.readonlyText} numberOfLines={2}>
                  {editItem?.item_name}
                </Text>
              </View>
              <View style={[styles.readonlyBox, { marginTop: 4 }]}>
                <MaterialCommunityIcons
                  name="barcode"
                  size={16}
                  color={Colors.textSecondary}
                />
                <Text style={styles.readonlyText}>
                  {editItem?.item_barcode}
                </Text>
              </View>

              {/* ERP fields (server transactions only) */}
              {editItem?.erp_document ? (
                <View
                  style={[
                    styles.readonlyBox,
                    { marginTop: 4, backgroundColor: "#e8f5e9" },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="file-document-outline"
                    size={16}
                    color="#2e7d32"
                  />
                  <Text style={[styles.readonlyText, { color: "#2e7d32" }]}>
                    ERP: {editItem.erp_document}
                    {editItem.erp_batch ? ` / ${editItem.erp_batch}` : ""}
                  </Text>
                </View>
              ) : null}
              {editItem?.sync_status && editItem.sync_status !== "pending" ? (
                <View
                  style={[
                    styles.readonlyBox,
                    { marginTop: 4, backgroundColor: "#e3f2fd" },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="check-circle-outline"
                    size={16}
                    color="#1565c0"
                  />
                  <Text style={[styles.readonlyText, { color: "#1565c0" }]}>
                    Status: {editItem.sync_status}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.label}>From Bin</Text>
              <TextInput
                style={styles.input}
                value={editFrombin}
                onChangeText={(t) =>
                  setEditFrombin(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                }
                autoCapitalize="characters"
                placeholder="e.g. A001"
              />

              <Text style={styles.label}>To Bin</Text>
              <TextInput
                style={styles.input}
                value={editTobin}
                onChangeText={(t) =>
                  setEditTobin(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                }
                autoCapitalize="characters"
                placeholder="e.g. B002"
              />

              <Text style={styles.label}>Quantity</Text>
              <CalcInput
                value={editQty}
                onValueChange={setEditQty}
                placeholder="e.g. 10 or 3x48"
              />

              <Text style={styles.label}>
                Notes{" "}
                <Text style={{ fontWeight: "400", color: Colors.textLight }}>
                  (optional)
                </Text>
              </Text>
              <TextInput
                style={styles.input}
                value={editNotes}
                onChangeText={(t) => setEditNotes(t.toUpperCase())}
                placeholder="e.g. DAMAGE, EXPIRY 2026-12"
                autoCapitalize="characters"
              />

              {validationMsg !== "" && (
                <Text style={styles.validationMsg}>{validationMsg}</Text>
              )}
            </ScrollView>

            {/* Buttons */}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeEdit}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        visible={!!deleteItem}
        transparent
        animationType="fade"
        onRequestClose={closeDelete}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteCard}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={22}
                color={Colors.error}
              />
              <Text
                style={[
                  styles.modalTitle,
                  { color: Colors.error, marginLeft: 8 },
                ]}
              >
                Delete Transaction
              </Text>
              <TouchableOpacity
                onPress={closeDelete}
                style={{ marginLeft: "auto" }}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.deleteQuestion}>
              Are you sure you want to delete this transaction?
            </Text>

            {/* Item info */}
            <View style={styles.deleteInfoBox}>
              <Text style={styles.deleteInfoCode}>{deleteItem?.item_code}</Text>
              <Text style={styles.deleteInfoName} numberOfLines={2}>
                {deleteItem?.item_name}
              </Text>
              <Text style={styles.deleteInfoMeta}>
                {deleteItem?.frombin} → {deleteItem?.tobin} • Qty:{" "}
                {deleteItem?.qty}
              </Text>
            </View>

            {/* Checkbox confirmation */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setDeleteConfirmed(!deleteConfirmed)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.checkbox,
                  deleteConfirmed && styles.checkboxChecked,
                ]}
              >
                {deleteConfirmed && (
                  <MaterialCommunityIcons name="check" size={14} color="#fff" />
                )}
              </View>
              <Text style={styles.checkboxLabel}>
                I confirm I want to permanently delete this record
              </Text>
            </TouchableOpacity>

            {/* Buttons */}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeDelete}>
                <Text style={styles.cancelBtnText}>No, Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deleteBtn,
                  (!deleteConfirmed || deleting) && styles.deleteBtnDisabled,
                ]}
                onPress={handleDelete}
                disabled={!deleteConfirmed || deleting}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.deleteBtnText}>Yes, Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
    color: Colors.textPrimary,
  },
  workerFilterBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight: 56,
  },
  workerFilterContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  workerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
    minHeight: 34,
  },
  workerChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  workerChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  workerChipTextActive: {
    color: "#fff",
  },
  countBar: {
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 30,
  },
  countText: { fontSize: 13, color: Colors.textSecondary, fontWeight: "600" },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary + "12",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  exportBtnText: { fontSize: 13, fontWeight: "700", color: Colors.primary },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 12,
    fontWeight: "600",
  },
  emptySubText: {
    fontSize: 13,
    color: Colors.textLight,
    marginTop: 6,
    textAlign: "center",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  readonlyBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 4,
    gap: 8,
  },
  readonlyText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginTop: 14,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: Colors.background,
    color: Colors.textPrimary,
  },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  saveBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 15, color: "#fff", fontWeight: "700" },
  validationMsg: {
    fontSize: 13,
    color: Colors.error,
    marginTop: 10,
    textAlign: "center",
  },

  // Delete Modal
  deleteCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  deleteQuestion: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 12,
  },
  deleteInfoBox: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  deleteInfoCode: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primary,
    marginBottom: 2,
  },
  deleteInfoName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  deleteInfoMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: Colors.error,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxChecked: { backgroundColor: Colors.error, borderColor: Colors.error },
  checkboxLabel: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  deleteBtn: {
    flex: 2,
    backgroundColor: Colors.error,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnText: { fontSize: 15, color: "#fff", fontWeight: "700" },
});
