// Selected market (country). Sent as X-Kiorex-Market so the API evaluates market-scope flags (market.<cc>.live) for it.
const KEY = "kx-market";
let current = "EG";
try { current = localStorage.getItem(KEY) ?? "EG"; } catch { /* storage may be blocked */ }
const listeners = new Set<() => void>();

export const getMarket = () => current;
export function setMarket(code: string) {
  current = code.toUpperCase();
  try { localStorage.setItem(KEY, current); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export const subscribeMarket = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
