import { useCallback, useState } from "react";
import * as WebBrowser from "expo-web-browser";

/** Opens a Kiorex Pay hosted checkout (mock PSP in dev) and then re-reads the order until `isDone`, or gives up after a few tries (the PSP webhook may land late). */
export function useHostedPay<T = never>(refetch?: () => Promise<T | undefined>, isDone?: (v: T) => boolean) {
  const [busy, setBusy] = useState(false);
  const pay = useCallback(async (checkoutUrl: string | null | undefined): Promise<"paid" | "pending" | "failed"> => {
    if (!checkoutUrl) return "failed";
    setBusy(true);
    try {
      await WebBrowser.openBrowserAsync(checkoutUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      if (!refetch || !isDone) return "pending";
      for (let i = 0; i < 5; i++) {
        const v = await refetch();
        if (v !== undefined && isDone(v)) return "paid";
        await new Promise((r) => setTimeout(r, 1500));
      }
      return "pending";
    } catch { return "failed"; } finally { setBusy(false); }
  }, [refetch, isDone]);
  return { pay, busy };
}
