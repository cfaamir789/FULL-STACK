/**
 * CalcInput — Inline quantity input with auto-calculate.
 *
 * Works with the phone's built-in keyboard. Type math like 3*48 or 10+5
 * and see the result shown inline. No modal popup — just type naturally.
 * The parent receives the final numeric value via onValueChange(number).
 */
import React, {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import Colors from "../theme/colors";

function evaluate(expr) {
  let s = expr.replace(/×/g, "*").replace(/x/gi, "*").replace(/−/g, "-");
  s = s.replace(/[^0-9.+\-*]/g, "");
  if (!s) return 0;
  try {
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
    // Multiplication first
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
    // Addition / subtraction
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

const hasOperator = (s) => /[+\-*×x]/i.test(s);

const CalcInput = forwardRef(function CalcInput(
  { value, onValueChange, placeholder, style },
  ref,
) {
  const [expr, setExpr] = useState(value || "");
  const inputRef = useRef(null);
  const result = evaluate(expr);
  const showResult = expr.length > 0 && hasOperator(expr) && result > 0;

  useEffect(() => {
    if (value !== undefined && value !== expr) setExpr(value);
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => {
      setExpr("");
      onValueChange?.("");
    },
  }));

  const handleChange = (text) => {
    // Allow digits, operators (*, +, -, x, ×, .)
    const clean = text.replace(/[^0-9.+\-×*xX]/g, "");
    setExpr(clean);
    // If plain number, pass immediately
    if (/^[0-9.]+$/.test(clean)) {
      onValueChange?.(clean);
    }
  };

  const handleBlur = () => {
    // Auto-evaluate on blur if expression has operators
    if (hasOperator(expr)) {
      const v = evaluate(expr);
      if (v > 0) {
        const final = String(v);
        setExpr(final);
        onValueChange?.(final);
      }
    } else {
      onValueChange?.(expr);
    }
  };

  return (
    <View style={style}>
      <View style={s.inputRow}>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={expr}
          onChangeText={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder || "Qty (e.g. 3*48)"}
          placeholderTextColor={Colors.textLight}
          keyboardType="numeric"
          returnKeyType="done"
        />
      </View>
      {showResult && (
        <Text style={s.resultText}>
          = {result}
        </Text>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  resultText: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: "700",
    marginTop: 4,
    marginLeft: 4,
  },
});

export default CalcInput;
