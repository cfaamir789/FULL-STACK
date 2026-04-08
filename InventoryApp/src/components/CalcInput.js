/**
 * CalcInput — A calculator-style Quantity input component.
 *
 * Shows current expression (e.g. "3×48") and the evaluated result.
 * Supports: +  −  ×  and parentheses-free left-to-right evaluation.
 * The parent receives the final numeric value via onValueChange(number).
 */
import React, {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

function evaluate(expr) {
  // Replace × with * and − with -
  let s = expr.replace(/×/g, "*").replace(/−/g, "-");
  // Remove anything that isn't digit, ., +, -, *
  s = s.replace(/[^0-9.+\-*]/g, "");
  if (!s) return 0;
  try {
    // Safe evaluation: only numbers and basic operations
    if (!/^[0-9.+\-*]+$/.test(s)) return 0;
    const parts = [];
    let current = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if ((ch === "+" || ch === "-" || ch === "*") && current.length > 0) {
        parts.push(parseFloat(current));
        parts.push(ch);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current) parts.push(parseFloat(current));

    // First pass: multiplication
    let i = 0;
    while (i < parts.length) {
      if (parts[i] === "*") {
        const prev = parts[i - 1];
        const next = parts[i + 1];
        parts.splice(i - 1, 3, prev * next);
        i = Math.max(0, i - 1);
      } else {
        i++;
      }
    }
    // Second pass: addition / subtraction
    let result = typeof parts[0] === "number" ? parts[0] : 0;
    for (let j = 1; j < parts.length; j += 2) {
      const op = parts[j];
      const val = typeof parts[j + 1] === "number" ? parts[j + 1] : 0;
      if (op === "+") result += val;
      else if (op === "-") result -= val;
    }
    return isNaN(result) ? 0 : Math.round(result * 1000) / 1000;
  } catch {
    return 0;
  }
}

const CalcInput = forwardRef(function CalcInput(
  { value, onValueChange, placeholder, style },
  ref,
) {
  const [expr, setExpr] = useState(value || "");
  const [showCalc, setShowCalc] = useState(false);
  const result = evaluate(expr);

  useEffect(() => {
    // Sync external value changes
    if (value !== undefined && value !== expr) {
      setExpr(value);
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => setShowCalc(true),
    clear: () => {
      setExpr("");
      onValueChange?.("");
    },
  }));

  const press = (ch) => {
    const next = expr + ch;
    setExpr(next);
  };

  const backspace = () => {
    setExpr(expr.slice(0, -1));
  };

  const clear = () => {
    setExpr("");
  };

  const done = () => {
    const v = evaluate(expr);
    const final = v > 0 ? String(v) : expr;
    setExpr(final);
    onValueChange?.(final);
    setShowCalc(false);
  };

  const handleDirectInput = (text) => {
    // Allow only digits and operators
    const clean = text.replace(/[^0-9.+\-×*]/g, "");
    setExpr(clean);
    // If it's a plain number, pass to parent immediately
    const num = parseFloat(clean);
    if (!isNaN(num) && /^[0-9.]+$/.test(clean)) {
      onValueChange?.(clean);
    }
  };

  const CalcButton = ({ label, onPress: op, color, bg, flex }) => (
    <TouchableOpacity
      style={[s.calcBtn, bg && { backgroundColor: bg }, flex && { flex }]}
      onPress={op || (() => press(label))}
      activeOpacity={0.6}
    >
      <Text style={[s.calcBtnText, color && { color }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={style}>
      <TouchableOpacity
        style={s.inputRow}
        onPress={() => setShowCalc(true)}
        activeOpacity={0.8}
      >
        <TextInput
          style={s.input}
          value={expr}
          onChangeText={handleDirectInput}
          placeholder={placeholder || "Qty (tap for calculator)"}
          placeholderTextColor={Colors.textLight}
          keyboardType="numeric"
          returnKeyType="done"
          onFocus={() => {}}
        />
        <TouchableOpacity style={s.calcIcon} onPress={() => setShowCalc(true)}>
          <MaterialCommunityIcons
            name="calculator"
            size={22}
            color={Colors.primary}
          />
        </TouchableOpacity>
      </TouchableOpacity>

      <Modal
        visible={showCalc}
        transparent
        animationType="slide"
        onRequestClose={done}
      >
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={done}>
          <View style={s.calcCard} onStartShouldSetResponder={() => true}>
            {/* Expression */}
            <View style={s.exprRow}>
              <Text style={s.exprText} numberOfLines={2}>
                {expr || "0"}
              </Text>
              <TouchableOpacity onPress={backspace} style={s.bksp}>
                <MaterialCommunityIcons
                  name="backspace-outline"
                  size={24}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {/* Result */}
            {expr.length > 0 && /[+\-×*]/.test(expr) && (
              <Text style={s.resultText}>= {result}</Text>
            )}
            {/* Keypad */}
            <View style={s.keypad}>
              <View style={s.keyRow}>
                <CalcButton label="7" />
                <CalcButton label="8" />
                <CalcButton label="9" />
                <CalcButton label="×" color="#9C27B0" bg="#F3E5F5" />
              </View>
              <View style={s.keyRow}>
                <CalcButton label="4" />
                <CalcButton label="5" />
                <CalcButton label="6" />
                <CalcButton label="−" color="#E65100" bg="#FFF3E0" />
              </View>
              <View style={s.keyRow}>
                <CalcButton label="1" />
                <CalcButton label="2" />
                <CalcButton label="3" />
                <CalcButton label="+" color="#1B5E20" bg="#E8F5E9" />
              </View>
              <View style={s.keyRow}>
                <CalcButton
                  label="C"
                  onPress={clear}
                  color={Colors.error}
                  bg="#FFEBEE"
                />
                <CalcButton label="0" />
                <CalcButton label="." />
                <CalcButton
                  label="="
                  onPress={done}
                  color="#fff"
                  bg={Colors.primary}
                />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
});

const s = StyleSheet.create({
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  calcIcon: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  calcCard: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 24,
  },
  exprRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: Colors.background,
    borderRadius: 10,
    marginBottom: 4,
  },
  exprText: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.textPrimary,
    flex: 1,
  },
  bksp: { padding: 6 },
  resultText: {
    fontSize: 18,
    color: Colors.success,
    fontWeight: "600",
    textAlign: "right",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  keypad: { gap: 8, marginTop: 6 },
  keyRow: { flexDirection: "row", gap: 8 },
  calcBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: Colors.background,
  },
  calcBtnText: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
});

export default CalcInput;
