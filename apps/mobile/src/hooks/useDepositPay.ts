import { useCallback, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { useDepositCheckout, qk } from "@/api/hooks";
import { api, send } from "@/api/client";
import type { Booking } from "@/api/types";

export type DepositOutcome = "paid" | "pending" | "failed";

/** After the hosted checkout closes, the PSP webhook may land a moment later: poll a few times before giving up. */
export async function waitForDeposit(fetchBooking: () => Promise<Pick<Booking, "depositStatus">>, tries = 5, delayMs = 1500, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<DepositOutcome> {
  for (let i = 0; i < tries; i++) {
    try {
      const b = await fetchBooking();
      if (b.depositStatus === "PAID") return "paid";
    } catch { /* keep trying */ }
    if (i < tries - 1) await sleep(delayMs);
  }
  return "pending";
}

/** KXMPAY01: opens the Kiorex Pay hosted checkout in a WebBrowser session, then re-reads the booking. */
export function useDepositPay() {
  const qc = useQueryClient();
  const checkout = useDepositCheckout();
  const [busy, setBusy] = useState(false);
  const pay = useCallback(async (bookingId: string): Promise<DepositOutcome> => {
    setBusy(true);
    try {
      const r = await checkout.mutateAsync(bookingId);
      if (!r.checkoutUrl) return "failed";
      await WebBrowser.openBrowserAsync(r.checkoutUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      const outcome = await waitForDeposit(async () => {
        const b = await send(api.GET("/api/v1/bookings/{id}", { params: { path: { id: bookingId } } }));
        qc.setQueryData(qk.booking(bookingId), b);
        return b;
      });
      return outcome;
    } catch { return "failed"; } finally { setBusy(false); void qc.invalidateQueries({ queryKey: qk.bookings }); }
  }, [checkout, qc]);
  return { pay, busy };
}
