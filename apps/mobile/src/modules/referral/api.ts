// GRW-P2-B3: patient referral and reward hooks (GET/POST /api/v1/growth/v1/referral/*, contracts kiorex-growth.v1 1.1.0, built by GRW-P2-B1/B2). The endpoints are not in the generated spec yet,
// so the shared openapi-fetch client (auth header, market, mock fetch, typed ApiError) is used with an untyped path. Nothing here sends a name, phone or e-mail.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "@/api/client";
import { loadBootstrap } from "@/lib/bootstrap";
import { prefs } from "@/lib/storage";

type R<D> = Promise<{ data?: D; error?: unknown; response: Response }>;
const raw = api as unknown as { GET<D>(p: string): R<D>; POST<D>(p: string, o: { body: unknown }): R<D> };

export type ReferralStatus = "ACTIVE" | "SUSPENDED";
export interface ReferralMe {
  code: string; status: ReferralStatus; inviteUrl?: string;
  counts: { invited?: number; signedUp?: number; qualified?: number };
  capsRemaining?: { last30Days?: number; thisYear?: number };
  rewards?: { activeCount?: number; activeMinor?: number; currency?: string };
}
export interface ReferralInvite { inviteUrl: string; code: string; shareText?: string }
export type RewardStatus = "ACTIVE" | "HELD" | "EXHAUSTED" | "EXPIRED" | "REVERSED";
export interface RewardLine { id: string; kind: string; mode: "CREDIT" | "COUPON"; amountMinor: number; remainingMinor?: number; currency: string; status: RewardStatus; expiresAt: string; couponState?: "UNREVEALED" | "REVEALED" | "NONE"; ref?: string }
export interface RewardList { items: RewardLine[]; nextCursor?: string | null }
export type ClaimStatus = "INVITED" | "SIGNED_UP" | "BOOKED" | "QUALIFIED" | "REJECTED" | "EXPIRED";

export const INVITE_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const normaliseInviteCode = (v: unknown): string | null => { if (typeof v !== "string") return null; const u = v.trim().toUpperCase(); return INVITE_CODE_RE.test(u) ? u : null; };

const CACHE = "kx.referral.me.v1";
/** Last good answer, kept on the device (code, link, counts: no name, no contact data) so the screen still shows something offline. */
export async function readCachedMe(): Promise<ReferralMe | null> {
  try { const v = JSON.parse((await prefs.get(CACHE)) ?? "null") as ReferralMe | null; return v && INVITE_CODE_RE.test(v.code) ? v : null; } catch { return null; }
}
export const clearCachedMe = () => prefs.set(CACHE, "");
const writeCachedMe = (v: ReferralMe) => prefs.set(CACHE, JSON.stringify({ code: v.code, status: v.status, inviteUrl: v.inviteUrl, counts: v.counts, capsRemaining: v.capsRemaining, rewards: v.rewards }));

export const useReferralMe = (enabled = true) => useQuery({
  queryKey: ["referral", "me"], enabled,
  queryFn: async () => { const v = await send(raw.GET<ReferralMe>("/api/v1/growth/v1/referral/me")); void writeCachedMe(v); return v; },
});
export const useCachedMe = (enabled: boolean) => useQuery({ queryKey: ["referral", "me-cached"], enabled, staleTime: Infinity, queryFn: readCachedMe });
export const useCreateInvite = () => useMutation({ mutationFn: (b: { channel: "LINK" | "WHATSAPP_SHARE" | "SMS" | "COPY"; locale: "ar" | "en" }) => send(raw.POST<ReferralInvite>("/api/v1/growth/v1/referral/invites", { body: b })) });
export const useReferralRewards = (enabled = true) => useQuery({ queryKey: ["referral", "rewards"], enabled, queryFn: () => send(raw.GET<RewardList>("/api/v1/growth/v1/referral/rewards")) });
/** The server shows a coupon code exactly once; the answer is held in component state only and never cached. */
export const useRevealCoupon = () => useMutation({ mutationFn: (lotId: string) => send(raw.POST<{ code: string }>(`/api/v1/growth/v1/rewards/${encodeURIComponent(lotId)}/reveal`, { body: {} })) });
export function useClaimInvite() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => send(raw.POST<{ status: ClaimStatus; reason?: string }>("/api/v1/growth/v1/referral/claim", { body: { code } })), onSuccess: () => void qc.invalidateQueries({ queryKey: ["referral"] }) });
}
/** Bootstrap `features.referral` (additive). Unknown, offline or false all mean "hide the entry". */
export const useReferralEnabled = () => {
  const q = useQuery({ queryKey: ["bootstrap", "referral"], staleTime: 300_000, retry: 0, queryFn: async () => (await loadBootstrap())?.features?.referral === true });
  return q.data === true;
};

/** Bootstrap `features.loyalty` (additive): true only when growth.loyalty is effectively ON for the market. Unknown, offline or false all mean "hide the entry". */
export const useLoyaltyEnabled = () => {
  const q = useQuery({ queryKey: ["bootstrap", "loyalty"], staleTime: 300_000, retry: 0, queryFn: async () => (await loadBootstrap())?.features?.loyalty === true });
  return q.data === true;
};
