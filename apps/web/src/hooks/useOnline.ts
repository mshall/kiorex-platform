import { useSyncExternalStore } from "react";

/** navigator.onLine as an external store (true where unavailable, e.g. SSR / jsdom without it). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); }; },
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
    () => true,
  );
}
