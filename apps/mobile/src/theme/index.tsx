import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { prefs } from "@/lib/storage";

// Kiorex design tokens (_brand/tokens.css): Indigo primary, Ocean secondary, coral Pulse as accent only.
export interface Palette {
  ink: string; ink2: string; pulse: string; ground: string; surface: string; text: string; muted: string; border: string;
  onInk: string; onDanger: string; soft: string; danger: string; dangerSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; overlay: string;
}
export const light: Palette = {
  ink: "#3730A3", ink2: "#0369A1", pulse: "#E8735E", ground: "#F4F6FC", surface: "#FFFFFF", text: "#1E1B4B", muted: "#475569", border: "#E2E8F0",
  onInk: "#FFFFFF", onDanger: "#FFFFFF", soft: "#EEF0FF", danger: "#B91C1C", dangerSoft: "#FEE2E2", success: "#047857", successSoft: "#D1FAE5", warning: "#B45309", warningSoft: "#FEF3C7", overlay: "rgba(15,16,36,0.5)",
};
export const dark: Palette = {
  ink: "#8B85F0", ink2: "#38BDF8", pulse: "#F08A75", ground: "#0F1024", surface: "#17183A", text: "#E8EAFB", muted: "#A5ACC8", border: "#2A2C55",
  onInk: "#0F1024", onDanger: "#3B0A0A", soft: "#23245A", danger: "#FCA5A5", dangerSoft: "#4C1D1D", success: "#6EE7B7", successSoft: "#064E3B", warning: "#FCD34D", warningSoft: "#4A3A0A", overlay: "rgba(0,0,0,0.65)",
};
export const radius = 14;
export const MIN_TOUCH = 44;

export type ThemePref = "system" | "light" | "dark";
interface Ctx { colors: Palette; scheme: "light" | "dark"; pref: ThemePref; setPref: (p: ThemePref) => void }
const ThemeCtx = createContext<Ctx>({ colors: light, scheme: "light", pref: "system", setPref: () => {} });
const KEY = "kx-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => { void prefs.get(KEY).then((v) => { if (v === "light" || v === "dark" || v === "system") setPrefState(v); }); }, []);
  const setPref = useCallback((p: ThemePref) => { setPrefState(p); void prefs.set(KEY, p); }, []);
  const scheme = pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
  const value = useMemo(() => ({ colors: scheme === "dark" ? dark : light, scheme, pref, setPref }), [scheme, pref, setPref]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);

/** Font family per language: Jost for Latin UI, IBM Plex Sans Arabic for Arabic (it also carries Latin glyphs). */
export type Weight = "regular" | "medium" | "semibold" | "bold";
export const fontFamily = (lang: string, w: Weight) => {
  const ar = { regular: "IBMPlexSansArabic_400Regular", medium: "IBMPlexSansArabic_500Medium", semibold: "IBMPlexSansArabic_600SemiBold", bold: "IBMPlexSansArabic_700Bold" };
  const en = { regular: "Jost_400Regular", medium: "Jost_500Medium", semibold: "Jost_600SemiBold", bold: "Jost_700Bold" };
  return (lang.startsWith("ar") ? ar : en)[w];
};
