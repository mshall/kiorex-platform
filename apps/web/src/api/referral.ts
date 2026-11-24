// GRW-P2-B3: patient referral and reward hooks over /api/v1/growth/v1/referral/* (contracts kiorex-growth.v1 1.1.0, built by GRW-P2-B1/B2) and the additive bootstrap field `features.referral`.
// These endpoints are not in the generated OpenAPI client yet, so they use a small authenticated fetch with the same market header and typed ApiError. Nothing here sends a name, phone or e-mail.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toApiError } from "./errors";
import { getMarket } from "@/lib/market";
import { useAuth } from "@/auth/AuthProvider";

export type ReferralStatus = "ACTIVE" | "SUSPENDED";
export interface ReferralMe {
  code: string; status: ReferralStatus; inviteUrl?: string;
  counts: { invited?: number; signedUp?: number; qualified?: number };
  /** B1 'me' also returns how many invites and rewards the person can still earn this year (optional while the API settles). */
  /** B1 `me`: how many more qualified friends can still earn the person a reward (30 days, this year). */
  capsRemaining?: { last30Days?: number; thisYear?: number };
  rewards?: { activeCount?: number; activeMinor?: number; currency?: string };
}
export interface ReferralInvite { inviteUrl: string; code: string; shareText?: string }
export type RewardStatus = "ACTIVE" | "HELD" | "EXHAUSTED" | "EXPIRED" | "REVERSED";
export interface RewardLine { id: string; kind: "REFERRER" | "REFEREE" | "REPEAT" | "PROMO" | "CORPORATE" | "LOYALTY" | "WELCOME" | "GOODWILL" | "CAMPAIGN" | "REFUND_CREDIT"; mode: "CREDIT" | "COUPON"; amountMinor: number; remainingMinor?: number; currency: string; status: RewardStatus; expiresAt: string; couponState?: "UNREVEALED" | "REVEALED" | "NONE"; ref?: string }
export interface RewardList { items: RewardLine[]; nextCursor?: string | null }
export type ClaimStatus = "INVITED" | "SIGNED_UP" | "BOOKED" | "QUALIFIED" | "REJECTED" | "EXPIRED";
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const normaliseCode = (v: unknown): string | null => { if (typeof v !== "string") return null; const u = v.trim().toUpperCase(); return CODE_RE.test(u) ? u : null; };

/** Authenticated JSON call; the token comes from useAuth() in each hook. */
async function call<T>(token: string | null, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${window.location.origin}/api/v1${path}`, { method, headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-Kiorex-Market": getMarket() }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw toApiError(r.status, json);
  return json as T;
}

const CACHE_KEY = "kx.referral.me.v1";
const readCache = (): ReferralMe | undefined => { try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); return v && typeof v.code === "string" && CODE_RE.test(v.code) ? (v as ReferralMe) : undefined; } catch { return undefined; } };
const writeCache = (v: ReferralMe) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ code: v.code, status: v.status, inviteUrl: v.inviteUrl, counts: v.counts, capsRemaining: v.capsRemaining, rewards: v.rewards })); } catch { /* storage unavailable */ } };
export const clearReferralCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ } };

/** The person's own code, counts and caps. The last good answer is kept on this device (no name, no contact data in it) and shown, labelled, while offline. */
export function useReferralMe(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["referral", "me"], enabled,
    queryFn: async () => { const v = await call<ReferralMe>(user?.token ?? null, "GET", "/growth/v1/referral/me"); writeCache(v); return v; },
  });
}
export const cachedReferralMe = readCache;

export function useCreateInvite() {
  const { user } = useAuth();
  return useMutation({ mutationFn: (b: { channel: "LINK" | "WHATSAPP_SHARE" | "SMS" | "COPY"; locale: "ar" | "en" }) => call<ReferralInvite>(user?.token ?? null, "POST", "/growth/v1/referral/invites", b) });
}
export function useReferralRewards(enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["referral", "rewards"], enabled, queryFn: () => call<RewardList>(user?.token ?? null, "GET", "/growth/v1/referral/rewards") });
}
/** The coupon code is shown exactly once by the server; the answer is held in component state only and never cached. */
export function useRevealCoupon() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (lotId: string) => call<{ code: string }>(user?.token ?? null, "POST", `/growth/v1/rewards/${encodeURIComponent(lotId)}/reveal`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ["referral", "rewards"] }) });
}
export function useClaimInvite() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => call<{ status: ClaimStatus; reason?: string }>(user?.token ?? null, "POST", "/growth/v1/referral/claim", { code }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["referral"] }) });
}

/** GET /api/v1/bootstrap, additive `features.referral`: true only when the growth.patient_referral flag is effectively ON for the market. Unknown or failing means false (the entry stays hidden). */
export function useReferralEnabled() {
  const q = useQuery({
    queryKey: ["bootstrap", "features"], staleTime: 300_000, retry: 0,
    queryFn: async () => { const r = await fetch(`${window.location.origin}/api/v1/bootstrap`, { headers: { Accept: "application/json", "X-Kiorex-Market": getMarket() } }); if (!r.ok) return { referral: false }; const j = (await r.json()) as { features?: { referral?: boolean } }; return { referral: j.features?.referral === true }; },
  });
  return { enabled: q.data?.referral === true, loading: q.isLoading };
}
