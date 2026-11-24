import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useProgress } from "./Pulse";
import { animationsEnabled, nativeDriver, useReducedMotion } from "@/lib/motion";
import { useTheme } from "@/theme";
import { Lockup } from "@/components/Logo";

/** Brand splash: the KIOREX lockup (waveform bars + coral pulse + wordmark) settles in on Indigo, then the screen fades out.
 *  Mounted above the app once fonts/i18n are ready (the native splash image shows the static mark until then). */
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { scheme } = useTheme();
  const reduced = useReducedMotion();
  const p = useProgress(1100, false, !reduced);
  const fade = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (!animationsEnabled) { setGone(true); done.current(); return; }
    const hold = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 260, easing: Easing.bezier(0.3, 0, 1, 1), useNativeDriver: nativeDriver }).start(() => { setGone(true); done.current(); });
    }, reduced ? 250 : 1350);
    return () => clearTimeout(hold);
  }, [fade, reduced]);
  if (gone) return null;
  const chev = Math.min(1, p * 2.2);
  return (
    <Animated.View pointerEvents="auto" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { opacity: fade, backgroundColor: scheme === "dark" ? "#0F1024" : "#3730A3", alignItems: "center", justifyContent: "center", zIndex: 1000 }]} testID="splash">
      {/* the full KIOREX lockup on the flat Indigo ground (Ground bars, Ocean-lift right bars, coral pulse, outlined-free live wordmark) settles in */}
      <View style={{ opacity: chev, transform: [{ scale: 0.94 + 0.06 * chev }] }} testID="splash-wordmark"><Lockup height={80} light /></View>
    </Animated.View>
  );
}
