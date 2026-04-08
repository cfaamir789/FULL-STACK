/**
 * VoiceMic — A small microphone icon that uses the Web Speech API (web)
 * or expo-speech (native) for speech-to-text.
 *
 * Currently supported on Web (Chrome, Edge) using SpeechRecognition.
 * On native, uses a fallback alert (native speech-to-text requires
 * expo-speech or react-native-voice which needs native modules).
 *
 * Props:
 *   onResult(text)    — called with recognized text (UPPERCASED)
 *   style             — container style override
 *   size              — icon size (default 20)
 *   lang              — recognition language (default "en-US")
 */
import React, { useState } from "react";
import { TouchableOpacity, StyleSheet, Platform, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "../theme/colors";

const IS_WEB = Platform.OS === "web";

const DIGIT_WORDS = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
};

function normalizeNumericSpeech(input) {
  const raw = String(input || "").toLowerCase();
  const parts = raw.split(/[^a-z0-9]+/).filter(Boolean);
  let out = "";
  for (const p of parts) {
    if (DIGIT_WORDS[p] != null) {
      out += DIGIT_WORDS[p];
      continue;
    }
    const digits = p.replace(/\D+/g, "");
    if (digits) out += digits;
  }
  return out;
}

export default function VoiceMic({
  onResult,
  style,
  size = 20,
  lang = "en-US",
  mode = "text", // "text" | "numeric"
  focusTargetRef,
}) {
  const [listening, setListening] = useState(false);

  const emitResult = (text) => {
    if (mode === "numeric") {
      onResult?.(normalizeNumericSpeech(text));
      return;
    }
    onResult?.(String(text || "").toUpperCase());
  };

  const startListening = () => {
    if (IS_WEB) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        Alert.alert(
          "Not Supported",
          "Voice input requires Chrome or Edge browser.",
        );
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setListening(true);
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        emitResult(text);
        setListening(false);
      };
      recognition.onerror = () => setListening(false);
      recognition.onend = () => setListening(false);
      recognition.start();
    } else {
      // Native: focus the target input so users can use keyboard voice typing.
      if (focusTargetRef?.current?.focus) {
        focusTargetRef.current.focus();
        return;
      }
      Alert.alert(
        "Voice Input",
        "Tap inside the field, then use your keyboard microphone.",
      );
    }
  };

  return (
    <TouchableOpacity
      style={[s.btn, listening && s.btnActive, style]}
      onPress={startListening}
      activeOpacity={0.6}
    >
      <MaterialCommunityIcons
        name={listening ? "microphone" : "microphone-outline"}
        size={size}
        color={listening ? "#fff" : Colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    padding: 6,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    backgroundColor: Colors.error,
  },
});
