// GRW-P4-D patient hooks (GET/POST /api/v1/growth/v1/loyalty/*). Own data only: no booking, provider or other person in any answer; no route moves, tops up, transfers or withdraws points. The shared client carries auth and market.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "@/api/client";

type R<D> = Promise<{ data?: D; error?: unknown; response: Response }>;
const raw = api as unknown as { GET<D>(p: string): R<D>; POST<D>(p: string, o: { body: unknown }): R<D> };

export type LoyaltyTier = "NONE" | "SILVER" | "GOLD" | "PLATINUM";
export interface LoyaltyMe {
  tier: LoyaltyTier; tierSince: string | null; window: { months: number; completed: number }; next: { tier: Exclude<LoyaltyTier, "NONE">; minCompletedBookings: number; remaining: number } | null;
  points: { balance: number; expiringSoon: { points: number; at: string } | null };
  conversion: { open: boolean; pointsRequired: number; valueMinor: number; currency: string; blocksLeftThisYear: number; canConvert: boolean }; notMoney: true;
}
export interface LoyaltyEntry { id: string; type: "ACCRUE" | "TIER_BONUS" | "EXPIRE" | "REVERSE" | "CONVERT"; points: number; direction: "IN" | "OUT"; expiresAt: string | null; at: string }
export interface Converted { lotId: string; mode: string; points: number; amountMinor: number; currency: string; balanceAfter: number }
export interface PartnerRedeemed { redeemed: true; lotId: string; amountMinor: number; currency: string; partner: { ar: string; en: string }; legalTextRef: string | null }

export const useLoyaltyMe = () => useQuery({ queryKey: ["loyalty", "me"], retry: 0, queryFn: () => send(raw.GET<LoyaltyMe>("/api/v1/growth/v1/loyalty/me")) });
export const useLoyaltyHistory = () => useQuery({ queryKey: ["loyalty", "history"], retry: 0, queryFn: () => send(raw.GET<{ items: LoyaltyEntry[] }>("/api/v1/growth/v1/loyalty/history?take=20")) });
/** One request key per tap, reused on a retry: a double tap or a retry after a lost answer can never spend twice. */
export function useConvertPoints() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (requestKey: string) => send(raw.POST<Converted>("/api/v1/growth/v1/loyalty/convert", { body: { requestKey } })), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["loyalty"] }); void qc.invalidateQueries({ queryKey: ["referral"] }); } });
}
export function useRedeemPartnerCode() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => send(raw.POST<PartnerRedeemed>("/api/v1/growth/v1/loyalty/partner/redeem", { body: { code } })), onSuccess: () => void qc.invalidateQueries({ queryKey: ["referral"] }) });
}
/** Same rule as the server and the web page: Crockford, 8 to 16 characters, separators ignored, look-alikes mapped. */
export function cleanPartnerCode(v: string): string | null {
  const s = v.normalize("NFKC").toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8,16}$/.test(s) ? s : null;
}
export const newRequestKey = () => `kx-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
