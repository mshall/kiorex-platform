// GRW-P4-D patient hooks over /api/v1/growth/v1/loyalty/*. Own data only: no booking, provider or other person in any answer, and no route moves, tops up, transfers or withdraws points.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toApiError } from "./errors";
import { useAuth } from "@/auth/AuthProvider";

export type LoyaltyTier = "NONE" | "SILVER" | "GOLD" | "PLATINUM";
export interface LoyaltyMe {
  tier: LoyaltyTier; tierSince: string | null; window: { months: number; completed: number }; next: { tier: Exclude<LoyaltyTier, "NONE">; minCompletedBookings: number; remaining: number } | null;
  points: { balance: number; expiringSoon: { points: number; at: string } | null };
  conversion: { open: boolean; pointsRequired: number; valueMinor: number; currency: string; blocksLeftThisYear: number; canConvert: boolean }; notMoney: true;
}
export interface LoyaltyEntry { id: string; type: "ACCRUE" | "TIER_BONUS" | "EXPIRE" | "REVERSE" | "CONVERT"; points: number; direction: "IN" | "OUT"; expiresAt: string | null; at: string }
export interface Converted { lotId: string; mode: string; points: number; amountMinor: number; currency: string; balanceAfter: number }
export interface PartnerRedeemed { redeemed: true; lotId: string; amountMinor: number; currency: string; partner: { ar: string; en: string }; legalTextRef: string | null }

async function call<T>(token: string | null, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${window.location.origin}/api/v1${path}`, { method, headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw toApiError(r.status, json);
  return json as T;
}
const P = "/growth/v1/loyalty";
export const useLoyaltyMe = () => { const { user } = useAuth(); return useQuery({ queryKey: ["loyalty", "me"], retry: 0, queryFn: () => call<LoyaltyMe>(user?.token ?? null, "GET", `${P}/me`) }); };
export const useLoyaltyHistory = () => { const { user } = useAuth(); return useQuery({ queryKey: ["loyalty", "history"], retry: 0, queryFn: () => call<{ items: LoyaltyEntry[] }>(user?.token ?? null, "GET", `${P}/history?take=20`) }); };
/** `requestKey` is created once per tap and reused on a retry, so a double tap or a network retry can never spend twice. */
export function useConvertPoints() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (requestKey: string) => call<Converted>(user?.token ?? null, "POST", `${P}/convert`, { requestKey }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["loyalty"] }); void qc.invalidateQueries({ queryKey: ["referral"] }); } });
}
export function useRedeemPartnerCode() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => call<PartnerRedeemed>(user?.token ?? null, "POST", `${P}/partner/redeem`, { code }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["referral"] }); } });
}
/** Same rule as the server: Crockford, 8 to 16 characters, separators ignored, look-alikes mapped. Returns the cleaned code or null. */
export function cleanPartnerCode(v: string): string | null {
  const s = v.normalize("NFKC").toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8,16}$/.test(s) ? s : null;
}
export const newRequestKey = () => `kx-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
