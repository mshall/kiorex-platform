import { useCallback, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "kx-theme";
/** The class on <html> is the source of truth: index.html sets it from the stored choice before first paint (light unless the user chose dark). */
const read = (): Theme => (typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light");

/** Light is the default. Only an explicit toggle is stored (per origin) and restored on the next visit. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice applies for this visit only */ }
      return next;
    });
  }, []);
  return { theme, toggle };
}
