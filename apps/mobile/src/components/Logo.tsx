import { View } from "react-native";
import { useTheme } from "@/theme";
import { KiorexLogo } from "@/brand/kiorex-logo/KiorexLogo.native";

/** KIOREX logo (founder spec 25 Nov 2026): 8-channel waveform + coral pulse; heights below 32 render the 4-channel micro mark. The app's own theme (light default, explicit dark) drives the colours.
 *  The master viewBox (440 x 130) carries clear space; ink = x 24..314, y 26..104, so the lockup is trimmed to its ink box and lines up with the screen gutter. */
const INK = { top: 26 / 130, left: 24 / 130, right: (440 - 314.5) / 130 };

/** Mark only (bars + pulse). `light` = on a flat Indigo ground. `width` kept for older call sites (height = width * 90 / 110). */
export function KiorexMark({ width = 60, light = false }: { width?: number; light?: boolean }) {
  const { scheme } = useTheme();
  return <View aria-hidden><KiorexLogo variant="mark" theme={scheme} onBrand={light} height={Math.round((width * 90) / 110)} title="" /></View>;
}

/** Full lockup (mark | coral divider | KIOREX), trimmed to its ink box. `height` is the viewBox height (ink is 60% of it): 64 = header bar, 56 = About / cards. */
export function Lockup({ height = 64, light = false }: { height?: number; light?: boolean }) {
  const { scheme } = useTheme();
  const m = { marginTop: -INK.top * height, marginBottom: -INK.top * height, marginLeft: -INK.left * height, marginRight: -INK.right * height };
  return <KiorexLogo variant="full" theme={scheme} onBrand={light} height={height} style={m} />;
}
