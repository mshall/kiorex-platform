import { useEffect, useRef, useState } from "react";
import { Animated, Easing, View, type ViewStyle } from "react-native";
import Svg, { Polyline, Rect } from "react-native-svg";
import { MASTER } from "@/brand/kiorex-logo/geometry";
import { useTheme } from "@/theme";
import { animationsEnabled, useReducedMotion } from "@/lib/motion";

/** The brand ECG pulse (same polyline as the KIOREX logo master, founder spec v2: 24..126 x 51..79). */
export const PULSE_POINTS = "24,65 64,65 68,61 72.5,51 77,79 81.5,57 85,65 126,65";
const LEN = 192;

/** Drives a 0..1 progress value as React state (works identically on native and web, no native-driver dependency). */
export function useProgress(duration: number, loop: boolean, enabled = true): number {
  const [p, setP] = useState(enabled ? 0 : 1);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled || !animationsEnabled) { setP(1); return; }
    const id = v.addListener(({ value }) => setP(value));
    v.setValue(0);
    const run = Animated.timing(v, { toValue: 1, duration, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: false });
    const anim = loop ? Animated.loop(Animated.sequence([run, Animated.delay(250)])) : run;
    anim.start();
    return () => { anim.stop(); v.removeListener(id); };
  }, [duration, loop, enabled, v]);
  return p;
}

/** Brand loading / success motif: the coral pulse line drawing itself. */
export function PulseLine({ width = 120, loop = true, color, style }: { width?: number; loop?: boolean; color?: string; style?: ViewStyle }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const p = useProgress(1400, loop, !reduced);
  return (
    <View style={style} aria-hidden>
      <Svg width={width} height={width * 0.3} viewBox="20 45 110 33">
        <Polyline points={PULSE_POINTS} fill="none" stroke={color ?? colors.pulse} strokeWidth={MASTER.pulseStroke} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={LEN} strokeDashoffset={LEN * (1 - p)} />
      </Svg>
    </View>
  );
}

/** Shimmer-free skeleton block (opacity pulse); honours reduced motion. */
export function Skeleton({ height = 16, width = "100%", radius = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: ViewStyle }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const o = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduced || !animationsEnabled) return;
    const a = Animated.loop(Animated.sequence([Animated.timing(o, { toValue: 1, duration: 800, useNativeDriver: false }), Animated.timing(o, { toValue: 0.55, duration: 800, useNativeDriver: false })]));
    a.start();
    return () => a.stop();
  }, [reduced, o]);
  return <Animated.View aria-hidden style={[{ height, width, borderRadius: radius, backgroundColor: colors.subtle, borderWidth: 1, borderColor: colors.hairline, opacity: o }, style]} />;
}

/** Brand illustration for empty / error / offline states: the soft KIOREX waveform bars with the coral pulse through the centre. */
export function BrandIllustration({ size = 132, tone = "empty" }: { size?: number; tone?: "empty" | "error" | "offline" }) {
  const { colors, scheme } = useTheme();
  const barOpacity = scheme === "dark" ? 0.6 : 0.22; // dark: the light ink at 0.22 vanished on the dark surface (a visible mark needs about 3:1)
  const pulse = tone === "error" ? colors.danger : colors.pulse;
  return (
    <View aria-hidden style={{ width: size, height: size * 0.82, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size * 0.82} viewBox="20 20 110 90">
        {MASTER.leftBars.map(([x, y, w, h], i) => <Rect key={`l${i}`} x={x} y={y} width={w} height={h} rx={MASTER.barRx} fill={colors.ink} fillOpacity={barOpacity} />)}
        {MASTER.rightBars.map(([x, y, w, h], i) => <Rect key={`r${i}`} x={x} y={y} width={w} height={h} rx={MASTER.barRx} fill={colors.ink2} fillOpacity={barOpacity} />)}
        {tone === "offline"
          ? <Polyline points="24,65 62,65 90,65 126,65" fill="none" stroke={pulse} strokeWidth={MASTER.pulseStroke} strokeLinecap="round" strokeDasharray="0.1 5" />
          : <Polyline points={PULSE_POINTS} fill="none" stroke={pulse} strokeWidth={MASTER.pulseStroke} strokeLinecap="round" strokeLinejoin="round" />}
      </Svg>
    </View>
  );
}
