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

export default function VoiceMic({
  onResult,
  style,
  size = 20,
  lang = "en-US",
}) {
  const [listening, setListening] = useState(false);

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
        onResult?.(text.toUpperCase());
        setListening(false);
      };
      recognition.onerror = () => setListening(false);
      recognition.onend = () => setListening(false);
      recognition.start();
    } else {
      // On native Android/iOS, the keyboard itself provides voice input.
      // We trigger an alert guiding the user to use the keyboard mic button.
      Alert.alert(
        "Voice Input",
        "Tap the microphone icon on your phone keyboard to speak.\n\nYour phone's built-in voice typing will be used.",
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
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    backgroundColor: Colors.error,
  },
});
