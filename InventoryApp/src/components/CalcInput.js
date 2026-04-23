/**
 * CalcInput — Calculator quantity input.
 * Uses a REAL TextInput for proper keyboard focus/navigation and physical keyboard support.
 * showSoftInputOnFocus={false} suppresses the system keyboard on mobile so our
 * custom pad acts as the keyboard. On web, physical keyboard input works naturally.
 * Press SAVE TRANSACTION (→) to evaluate math and save.
 */
import React, {
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

function evaluate(expr) {
  let s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  s = s.replace(/[^0-9.+\-*/]/g, "");
  if (!s) return null;
  try {
    if (!/^[0-9.+\-*/]+$/.test(s)) return null;
    const parts = [];
    let current = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if ("+-*/".includes(ch) && current.length > 0) {
        parts.push(parseFloat(current));
        parts.push(ch);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current) parts.push(parseFloat(current));
    for (let pass = 0; pass < 2; pass++) {
      const ops = pass === 0 ? ["*", "/"] : ["+", "-"];
      let i = 0;
      while (i < parts.length) {
        if (ops.includes(parts[i])) {
          const prev = parts[i - 1];
          const next = parts[i + 1];
          let res;
          if (parts[i] === "*") res = prev * next;
          else if (parts[i] === "/") res = next !== 0 ? prev / next : 0;
          else if (parts[i] === "+") res = prev + next;
          else res = prev - next;
          parts.splice(i - 1, 3, res);
          i = Math.max(0, i - 1);
        } else {
          i++;
        }
      }
    }
    const result = parts[0];
    return isNaN(result) ? null : Math.round(result * 1000) / 1000;
  } catch {
    return null;
  }
}

const hasOperator = (s) => /[+\-×÷*/−]/.test(s);

const OP_KEYS = new Set(["÷", "×", "−", "+"]);

const CalcInput = forwardRef(function CalcInput(
  { value, onValueChange, placeholder, onSubmitEditing, style },
  ref,
) {
  const [expr, setExpr] = useState(value != null ? String(value) : "");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const v = value != null ? String(value) : "";
    if (v !== expr) setExpr(v);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // focus() called by parent (e.g. when To Bin presses Enter)
  useImperativeHandle(ref, () => ({
    focus: () => {
      setOpen(true);
      // Longer delay for slow phones (1GB RAM / Zebra PDT) to ensure
      // the calculator pad renders before the TextInput tries to focus
      setTimeout(() => inputRef.current?.focus(), 120);
    },
    blur: () => {
      inputRef.current?.blur();
    },
    clear: () => {
      setExpr("");
      onValueChange?.("");
    },
  }));

  const notifyParent = (e) => {
    if (/^[0-9]+(\.[0-9]*)?$/.test(e)) onValueChange?.(e);
    else if (e === "") onValueChange?.("");
  };

  // Called by pad buttons
  const handleKey = (key) => {
    if (key === "⌫") {
      const next = expr.slice(0, -1);
      setExpr(next);
      notifyParent(next);
      return;
    }
    if (key === "→") {
      const raw = hasOperator(expr) ? evaluate(expr) : parseFloat(expr);
      const finalNum =
        raw != null && !isNaN(raw) && raw > 0 ? Math.round(raw) : null;
      if (finalNum == null) return;
      const finalStr = String(finalNum);
      setExpr(finalStr);
      onValueChange?.(finalStr);
      setOpen(false);
      inputRef.current?.blur();
      onSubmitEditing?.(finalStr); // → triggers handleSave in parent
      return;
    }
    const next = expr + key;
    setExpr(next);
    notifyParent(next);
    // Keep TextInput focused so physical keyboard still works
    inputRef.current?.focus();
  };

  // Called when user types on physical keyboard
  const handleTextChange = (text) => {
    const clean = text.replace(/[^0-9.+\-×÷*/−]/g, "");
    setExpr(clean);
    notifyParent(clean);
  };

  // Enter key on physical keyboard → save transaction
  const handleSubmitEditing = () => handleKey("→");

  const preview = hasOperator(expr) ? evaluate(expr) : null;

  return (
    <View style={[s.wrapper, style]}>
      {/* ── Display row — REAL TextInput so keyboard nav + physical keyboard works ── */}
      <View style={[s.displayWrap, open && s.displayFocused]}>
        <TextInput
          ref={inputRef}
          style={s.displayInput}
          value={expr}
          placeholder={placeholder || "Qty — tap or press Enter from To Bin"}
          placeholderTextColor={Colors.textLight}
          onFocus={() => setOpen(true)}
          onChangeText={handleTextChange}
          onSubmitEditing={handleSubmitEditing}
          keyboardType="number-pad"
          showSoftInputOnFocus={false}
          returnKeyType="done"
          blurOnSubmit={false}
          caretHidden={false}
          selectionColor={Colors.primary}
        />
        {preview !== null && (
          <View style={s.previewBadge}>
            <Text style={s.previewInline}>= {preview}</Text>
          </View>
        )}
        {expr.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setExpr("");
              onValueChange?.("");
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginRight: 4 }}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={20}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          style={s.calcIcon}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons
            name="calculator"
            size={22}
            color={open ? Colors.primary : Colors.textLight}
          />
        </TouchableOpacity>
      </View>

      {/* ── Keypad ── */}
      {open && (
        <View style={s.pad}>
          {/* Row 1: 7 8 9  ⌫ */}
          <View style={s.row}>
            {["7", "8", "9"].map((key) => (
              <TouchableOpacity key={key} style={s.key} onPress={() => handleKey(key)} activeOpacity={0.65}>
                <Text style={s.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.key, s.keyBack]} onPress={() => handleKey("⌫")} activeOpacity={0.65}>
              <MaterialCommunityIcons name="backspace-outline" size={24} color="#c0392b" />
            </TouchableOpacity>
          </View>
          {/* Row 2: 4 5 6  💾 SAVE */}
          <View style={s.row}>
            {["4", "5", "6"].map((key) => (
              <TouchableOpacity key={key} style={s.key} onPress={() => handleKey(key)} activeOpacity={0.65}>
                <Text style={s.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.key, s.keySave]} onPress={() => handleKey("→")} activeOpacity={0.65}>
              <MaterialCommunityIcons name="content-save" size={18} color="#fff" />
              <Text style={s.keySaveText}> SAVE</Text>
            </TouchableOpacity>
          </View>
          {/* Row 3: 1 2 3  × */}
          <View style={s.row}>
            {["1", "2", "3"].map((key) => (
              <TouchableOpacity key={key} style={s.key} onPress={() => handleKey(key)} activeOpacity={0.65}>
                <Text style={s.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.key, s.keyOp]} onPress={() => handleKey("×")} activeOpacity={0.65}>
              <Text style={[s.keyText, s.keyOpText]}>×</Text>
            </TouchableOpacity>
          </View>
          {/* Row 4: 0  ÷  −  + */}
          <View style={s.row}>
            {["÷", "0", "−", "+"].map((key) => (
              <TouchableOpacity key={key} style={[s.key, OP_KEYS.has(key) && s.keyOp]} onPress={() => handleKey(key)} activeOpacity={0.65}>
                <Text style={[s.keyText, OP_KEYS.has(key) && s.keyOpText]}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  wrapper: { marginBottom: 2 },
  displayWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingRight: 10,
    minHeight: 52,
    overflow: "hidden",
  },
  displayFocused: { borderColor: Colors.primary, borderWidth: 2 },
  displayInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 20,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: 0.5,
    // Ensure the input fills the row on web
    outlineStyle: "none",
  },
  calcIcon: { paddingHorizontal: 4 },
  previewText: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: "700",
    marginTop: 4,
    marginLeft: 4,
  },
  previewBadge: {
    backgroundColor: "#E8F5E9",
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 4,
    marginHorizontal: 6,
    borderWidth: 1.5,
    borderColor: "#A5D6A7",
    shadowColor: Colors.success,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  previewInline: {
    fontSize: 16,
    color: "#2E7D32",
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  pad: {
    marginTop: 6,
    backgroundColor: "#F1F4F8",
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 5,
  },
  row: { flexDirection: "row", gap: 6 },
  key: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
  keyText: { fontSize: 20, fontWeight: "600", color: Colors.textPrimary },
  keyOp: { backgroundColor: "#EEF2FF" },
  keyOpText: { color: Colors.primary, fontWeight: "800" },
  keyWide: { flex: 2, flexDirection: "row" },
  keyBack: { backgroundColor: "#FFF0F0" },
  keySave: { backgroundColor: Colors.primary, flexDirection: "row" },
  keySaveText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});

export default CalcInput;
