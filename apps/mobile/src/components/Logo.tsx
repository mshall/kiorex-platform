import Svg, { Line, Polyline } from "react-native-svg";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { T } from "./ui";

/** Kiorex mark (_brand/kiorex-mark.svg): indigo + ocean strokes crossing, coral ECG pulse through the centre. */
export function KiorexMark({ width = 60, light = false }: { width?: number; light?: boolean }) {
  const { colors } = useTheme();
  const a = light ? "#FFFFFF" : colors.ink; const b = light ? "#FFFFFF" : colors.ink2;
  return (
    <View aria-hidden>
    <Svg width={width} height={(width * 80) / 120} viewBox="0 0 120 80">
      <Line x1={28} y1={6} x2={72} y2={74} stroke={a} strokeWidth={7} />
      <Line x1={92} y1={6} x2={48} y2={74} stroke={b} strokeWidth={7} />
      <Polyline points="2,40 52,40 55,35 58,46 62,28 66,44 69,40 118,40" fill="none" stroke="#E8735E" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
    </View>
  );
}

/** Wordmark: KIOREX letter-spaced, final X in Ocean. */
export function Wordmark({ size = 22 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", direction: "ltr" }} accessible accessibilityRole="image" accessibilityLabel="Kiorex">
      <T weight="bold" style={{ fontSize: size, letterSpacing: size * 0.18, color: colors.ink }} forceLatin>KIORE</T>
      <T weight="bold" style={{ fontSize: size, letterSpacing: size * 0.18, color: colors.ink2 }} forceLatin>X</T>
    </View>
  );
}
