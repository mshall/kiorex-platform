// GRW-P2-S: the sponsored discount a patient sees at checkout. Endpoint: GET /api/v1/growth/v1/promotions/quote?bookingId= (not in the generated client yet). The answer is `{ quote: null }` when nothing applies;
// with the flag OFF the API answers 403 FEATURE_DISABLED, which is treated as "no discount" (the checkout then looks exactly as before). Nothing here sends a name, phone or e-mail.
import { useQuery } from "@tanstack/react-query";
import { getMarket } from "@/lib/market";
import { useAuth } from "@/auth/AuthProvider";

export interface SponsoredQuote {
  promotionId: string; amountMinor: number; currency: string; endsAt: string;
  label: { ar: string; en: string }; sponsor: { ar: string; en: string };
  lines?: Array<{ code: string; amountMinor: number; labelKey: string }>;
}

export function useSponsoredQuote(bookingId: string | undefined, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["sponsored-quote", bookingId], enabled: enabled && !!bookingId, staleTime: 60_000, retry: false,
    queryFn: async (): Promise<SponsoredQuote | null> => {
      const r = await fetch(`${window.location.origin}/api/v1/growth/v1/promotions/quote?bookingId=${encodeURIComponent(bookingId ?? "")}`, { headers: { Accept: "application/json", ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}), "X-Kiorex-Market": getMarket() } });
      if (!r.ok) return null; // flag OFF (403), unknown booking (404) or an outage: the booking goes on at the full price
      const j = (await r.json().catch(() => null)) as { quote?: SponsoredQuote | null } | null;
      const q = j?.quote;
      return q && Number.isInteger(q.amountMinor) && q.amountMinor > 0 ? q : null;
    },
  });
}

/** What the patient pays now for a deposit after the sponsored line, before any credit: the card never goes below one minor unit (same rule as Kiorex Pay). Amounts in EGP (major units). */
export const depositAfterSponsored = (requiredEgp: number, sponsoredMinor: number): number => {
  const req = Math.round(requiredEgp * 100); const s = Math.max(0, Math.min(sponsoredMinor, req - 1));
  return (req - s) / 100;
};
