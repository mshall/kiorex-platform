import { useSyncExternalStore } from "react";

/** matchMedia as external store. Falls back to `fallback` where matchMedia is unavailable (jsdom, SSR). */
export function useMediaQuery(query: string, fallback = true): boolean {
  const sub = (cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const m = window.matchMedia(query);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  };
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(sub, get, () => fallback);
}
