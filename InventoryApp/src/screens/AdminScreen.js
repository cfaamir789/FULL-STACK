import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  getUsers,
  registerWorker,
  deleteUser,
  changeUserRole,
} from "../services/api";
import Colors from "../theme/colors";
import { isAdminRole, isSuperAdminRole } from "../utils/roles";

export default function AdminScreen({ viewerRole = "admin" }) {
  const canManageAdmins = isSuperAdminRole(viewerRole);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState("worker");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [showRoleChange, setShowRoleChange] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState(null);
  const [roleChanging, setRoleChanging] = useState(false);
  const [roleChangeError, setRoleChangeError] = useState("");

  const displayRole = (role) => {
    if (role === "superadmin") return "SUPER ADMIN";
    if (role === "worker") return "PICKER";
    return role.toUpperCase();
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await getUsers());
    } catch (err) {
      Alert.alert(
        "Error",
        err?.response?.data?.error || err.message || "Could not load users.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUsers();
    }, [loadUsers]),
  );

  const openAdd = () => {
    setNewUsername("");
    setNewPin("");
    setNewRole("worker");
    setAddError("");
    setShowAdd(true);
  };

  const handleAdd = async () => {
    const u = newUsername.trim().toUpperCase();
    const p = newPin.trim();
    if (!u || !p) {
      setAddError("Username and PIN are required.");
      return;
    }
    if (p.length < 4) {
      setAddError("PIN must be at least 4 digits.");
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      await registerWorker(u, p, canManageAdmins ? newRole : "worker");
      setShowAdd(false);
      loadUsers();
    } catch (err) {
      setAddError(
        err?.response?.data?.error || err.message || "Could not create user.",
      );
    } finally {
      setAdding(false);
    }
  };

  const openRoleChange = (user) => {
    setRoleChangeTarget(user);
    setRoleChangeError("");
    setShowRoleChange(true);
  };

  const confirmRoleChange = async (newRoleValue) => {
    if (!roleChangeTarget) return;
    setRoleChanging(true);
    setRoleChangeError("");
    try {
      await changeUserRole(roleChangeTarget.username, newRoleValue);
      setShowRoleChange(false);
      setRoleChangeTarget(null);
      loadUsers();
    } catch (err) {
      setRoleChangeError(
        err?.response?.data?.error || err.message || "Could not change role.",
      );
    } finally {
      setRoleChanging(false);
    }
  };

  const handleDelete = (user) => {
    Alert.alert(
      "Delete User",
      `Remove "${user.username}"? They will no longer be able to log in.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteUser(user.username);
              loadUsers();
            } catch (err) {
              Alert.alert(
                "Error",
                err?.response?.data?.error ||
                  err.message ||
                  "Could not delete user.",
              );
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerCount}>
          {users.length} user{users.length !== 1 ? "s" : ""}
        </Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <MaterialCommunityIcons name="account-plus" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add User</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialCommunityIcons
                name="account-group"
                size={56}
                color={Colors.textLight}
              />
              <Text style={styles.emptyText}>No users yet.</Text>
              <Text style={styles.emptySubText}>
                Tap "Add User" to create a Picker or Checker account.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.userRow}>
              <View style={styles.userAvatar}>
                <MaterialCommunityIcons
                  name={
                    item.role === "superadmin"
                      ? "crown"
                      : isAdminRole(item.role)
                        ? "shield-account"
                        : item.role === "checker"
                          ? "account-search"
                          : "account-hard-hat"
                  }
                  size={26}
                  color={
                    item.role === "superadmin"
                      ? Colors.error
                      : isAdminRole(item.role)
                        ? Colors.primary
                        : item.role === "checker"
                          ? Colors.warning
                          : Colors.textSecondary
                  }
                />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{item.username}</Text>
                <View
                  style={[
                    styles.roleBadge,
                    item.role === "superadmin"
                      ? styles.roleSuperAdmin
                      : isAdminRole(item.role)
                        ? styles.roleAdmin
                        : item.role === "checker"
                          ? styles.roleChecker
                          : styles.roleWorker,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleText,
                      item.role === "superadmin"
                        ? styles.roleTextSuperAdmin
                        : isAdminRole(item.role)
                          ? styles.roleTextAdmin
                          : item.role === "checker"
                            ? styles.roleTextChecker
                            : styles.roleTextWorker,
                    ]}
                  >
                    {displayRole(item.role)}
                  </Text>
                </View>
              </View>
              {item.role !== "superadmin" && (
                <TouchableOpacity
                  style={styles.roleChangeBtn}
                  onPress={() => openRoleChange(item)}
                >
                  <MaterialCommunityIcons
                    name="swap-horizontal"
                    size={20}
                    color={Colors.primary}
                  />
                </TouchableOpacity>
              )}
              {(item.role === "worker" ||
                item.role === "checker" ||
                (item.role === "admin" && canManageAdmins)) && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(item)}
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={20}
                    color={Colors.error}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      <Modal
        visible={showAdd}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAdd(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New User</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. SADAM"
                placeholderTextColor={Colors.textLight}
                value={newUsername}
                onChangeText={setNewUsername}
                autoCapitalize="characters"
                returnKeyType="next"
                autoFocus
              />
              <Text style={styles.label}>PIN (min 4 digits)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 1234"
                placeholderTextColor={Colors.textLight}
                value={newPin}
                onChangeText={setNewPin}
                keyboardType="numeric"
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
              <Text style={styles.label}>Role</Text>
              <View style={styles.roleToggleRow}>
                <TouchableOpacity
                  style={[
                    styles.roleToggle,
                    newRole === "worker" && styles.roleToggleActive,
                  ]}
                  onPress={() => setNewRole("worker")}
                >
                  <MaterialCommunityIcons
                    name="account-hard-hat"
                    size={16}
                    color={newRole === "worker" ? "#fff" : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.roleToggleText,
                      newRole === "worker" && styles.roleToggleTextActive,
                    ]}
                  >
                    Picker
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.roleToggle,
                    newRole === "checker" && styles.roleToggleCheckerActive,
                  ]}
                  onPress={() => setNewRole("checker")}
                >
                  <MaterialCommunityIcons
                    name="account-search"
                    size={16}
                    color={
                      newRole === "checker" ? "#fff" : Colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.roleToggleText,
                      newRole === "checker" && styles.roleToggleTextActive,
                    ]}
                  >
                    Checker
                  </Text>
                </TouchableOpacity>
                {canManageAdmins && (
                  <TouchableOpacity
                    style={[
                      styles.roleToggle,
                      newRole === "admin" && styles.roleToggleActive,
                    ]}
                    onPress={() => setNewRole("admin")}
                  >
                    <MaterialCommunityIcons
                      name="shield-account"
                      size={16}
                      color={
                        newRole === "admin" ? "#fff" : Colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.roleToggleText,
                        newRole === "admin" && styles.roleToggleTextActive,
                      ]}
                    >
                      Admin
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {addError ? (
                <Text style={styles.errorText}>{addError}</Text>
              ) : null}
              <TouchableOpacity
                style={[styles.saveBtn, adding && styles.saveBtnDisabled]}
                onPress={handleAdd}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialCommunityIcons
                    name="account-plus"
                    size={18}
                    color="#fff"
                  />
                )}
                <Text style={styles.saveBtnText}>
                  {adding ? "Creating..." : "Create User"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Role Change Modal ─────────────────────────────────────── */}
      <Modal
        visible={showRoleChange}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoleChange(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Change Role
                {roleChangeTarget ? ` — ${roleChangeTarget.username}` : ""}
              </Text>
              <TouchableOpacity onPress={() => setShowRoleChange(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {roleChangeTarget && (
              <Text
                style={{
                  color: Colors.textSecondary,
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                Current role:{" "}
                <Text style={{ fontWeight: "700", color: Colors.textPrimary }}>
                  {displayRole(roleChangeTarget.role)}
                </Text>
              </Text>
            )}
            <Text style={styles.label}>Select New Role</Text>
            <View style={[styles.roleToggleRow, { marginTop: 8 }]}>
              <TouchableOpacity
                style={[
                  styles.roleToggle,
                  roleChangeTarget?.role === "worker" && { opacity: 0.4 },
                  roleChangeTarget?.role !== "worker" &&
                    styles.roleToggleActive,
                ]}
                disabled={roleChanging || roleChangeTarget?.role === "worker"}
                onPress={() => confirmRoleChange("worker")}
              >
                <MaterialCommunityIcons
                  name="account-hard-hat"
                  size={18}
                  color="#fff"
                />
                <Text
                  style={[styles.roleToggleText, styles.roleToggleTextActive]}
                >
                  Picker
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleToggle,
                  roleChangeTarget?.role === "checker" && { opacity: 0.4 },
                  roleChangeTarget?.role !== "checker" &&
                    styles.roleToggleCheckerActive,
                ]}
                disabled={roleChanging || roleChangeTarget?.role === "checker"}
                onPress={() => confirmRoleChange("checker")}
              >
                <MaterialCommunityIcons
                  name="account-search"
                  size={18}
                  color="#fff"
                />
                <Text
                  style={[styles.roleToggleText, styles.roleToggleTextActive]}
                >
                  Checker
                </Text>
              </TouchableOpacity>
            </View>
            {canManageAdmins && (
              <View style={[styles.roleToggleRow, { marginTop: 8 }]}>
                <TouchableOpacity
                  style={[
                    styles.roleToggle,
                    roleChangeTarget?.role === "admin" && { opacity: 0.4 },
                    roleChangeTarget?.role !== "admin" &&
                      styles.roleToggleActive,
                  ]}
                  disabled={roleChanging || roleChangeTarget?.role === "admin"}
                  onPress={() => confirmRoleChange("admin")}
                >
                  <MaterialCommunityIcons
                    name="shield-account"
                    size={18}
                    color="#fff"
                  />
                  <Text
                    style={[styles.roleToggleText, styles.roleToggleTextActive]}
                  >
                    Admin
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {roleChanging && (
              <ActivityIndicator
                color={Colors.primary}
                style={{ marginTop: 12 }}
              />
            )}
            {roleChangeError ? (
              <Text style={[styles.errorText, { marginTop: 8 }]}>
                {roleChangeError}
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  headerCount: { fontSize: 14, color: Colors.textSecondary },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
  },
  emptySubText: { color: Colors.textLight, fontSize: 13, marginTop: 4 },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 10,
    padding: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleSuperAdmin: { backgroundColor: Colors.error + "20" },
  roleAdmin: { backgroundColor: Colors.primary + "20" },
  roleWorker: { backgroundColor: Colors.success + "20" },
  roleChecker: { backgroundColor: Colors.warning + "25" },
  roleText: { fontSize: 11, fontWeight: "700" },
  roleTextSuperAdmin: { color: Colors.error },
  roleTextAdmin: { color: Colors.primary },
  roleTextWorker: { color: Colors.success },
  roleTextChecker: { color: Colors.warning },
  roleChangeBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.primary + "15",
    marginRight: 4,
  },
  deleteBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.error + "10",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    marginBottom: 4,
  },
  roleToggleRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  roleToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  roleToggleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  roleToggleCheckerActive: {
    backgroundColor: Colors.warning,
    borderColor: Colors.warning,
  },
  roleToggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  roleToggleTextActive: { color: "#fff" },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 4,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 16,
  },
  saveBtnDisabled: { backgroundColor: Colors.textLight },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
