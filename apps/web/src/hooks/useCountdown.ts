import { useEffect, useState } from "react";

/** Remaining ms until `iso` (null when no deadline). Ticks every second. */
export function useCountdown(iso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return { remainingMs: null as number | null, expired: false };
  const remainingMs = Math.max(0, new Date(iso).getTime() - now);
  return { remainingMs, expired: remainingMs === 0 };
}
