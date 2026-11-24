// GRW-P2-S: the sponsored discount a patient sees at checkout (GET /api/v1/growth/v1/promotions/quote?bookingId=). Not in the generated spec yet, so the shared client is used with an untyped path.
// `{ quote: null }`, the flag OFF (403) or any failure all mean "no discount": the booking goes on at the full price. Nothing here sends a name, phone or e-mail.
import { useQuery } from "@tanstack/react-query";
import { api, send } from "@/api/client";

type R<D> = Promise<{ data?: D; error?: unknown; response: Response }>;
const raw = api as unknown as { GET<D>(p: string): R<D> };

export interface SponsoredQuote {
  promotionId: string; amountMinor: number; currency: string; endsAt: string;
  label: { ar: string; en: string }; sponsor: { ar: string; en: string };
}

export const useSponsoredQuote = (bookingId: string | undefined, enabled = true) => useQuery({
  queryKey: ["sponsored-quote", bookingId], enabled: enabled && !!bookingId, staleTime: 60_000, retry: false,
  queryFn: async (): Promise<SponsoredQuote | null> => {
    try {
      const j = await send(raw.GET<{ quote?: SponsoredQuote | null }>(`/api/v1/growth/v1/promotions/quote?bookingId=${encodeURIComponent(bookingId ?? "")}`));
      const q = j?.quote; return q && Number.isInteger(q.amountMinor) && q.amountMinor > 0 ? q : null;
    } catch { return null; }
  },
});

/** The deposit after the sponsored line, before any credit, in EGP: the card never goes below one minor unit (same rule as Kiorex Pay). */
export const depositAfterSponsored = (depositMinor: number, sponsoredMinor: number): number => (depositMinor - Math.max(0, Math.min(sponsoredMinor, depositMinor - 1))) / 100;
