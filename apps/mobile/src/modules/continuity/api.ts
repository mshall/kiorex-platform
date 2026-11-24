// GRW-P4-A: the patient's own continuity cards (clinic visit -> pharmacy, lab, home visit): GET /api/v1/growth/v1/continuity/cards, PUT .../consent, POST .../cards/:id/dismiss.
// Not in the generated spec yet, so the shared client is used with untyped paths. With the flag OFF or locked (or any failure) the answer is "no cards" and the home screen looks exactly as before.
// Nothing here sends a name, phone, e-mail, item or test name: only the card id travels back, in a header on the order, booking or care-plan request the patient chooses to make.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "@/api/client";

type R<D> = Promise<{ data?: D; error?: unknown; response: Response }>;
const raw = api as unknown as { GET<D>(p: string): R<D>; PUT<D>(p: string, o: { body: unknown }): R<D>; POST<D>(p: string, o?: { body?: unknown }): R<D> };

export type ContinuityKind = "RX_TO_PHARMACY" | "LAB_ORDER_TO_LAB" | "CARE_PLAN_TO_HOME_VISIT";
export interface ContinuityCard { id: string; kind: ContinuityKind; toProduct: "PHARMACY" | "LAB" | "NURSE"; expiresAt: string; recordId?: string; path: string }
export interface ContinuityCards { enabled: boolean; consent: boolean; cards: ContinuityCard[] }

const BASE = "/api/v1/growth/v1/continuity";
export const CONTINUITY_HEADER = "X-Kx-Continuity";
export const CONTINUITY_PATHS: readonly string[] = ["/api/v1/pharmacy/orders", "/api/v1/lab/bookings", "/api/v1/care-plans"];
const TTL_MS = 30 * 60_000;
let remembered: { id: string; at: number } | null = null; // this app session only; never written to disk

export const rememberCard = (id: string, now = Date.now()) => { remembered = { id, at: now }; };
export const clearCard = () => { remembered = null; };
export function currentCard(now = Date.now()): string | null { return remembered && now - remembered.at < TTL_MS && /^[A-Za-z0-9_-]{10,40}$/.test(remembered.id) ? remembered.id : null; }

export const useContinuityCards = (enabled = true) => useQuery({
  queryKey: ["continuity-cards"], enabled, staleTime: 60_000, retry: false,
  queryFn: async (): Promise<ContinuityCards> => {
    try { const r = await send(raw.GET<ContinuityCards>(`${BASE}/cards`)); return r.enabled && Array.isArray(r.cards) ? r : { enabled: false, consent: false, cards: [] }; } catch { return { enabled: false, consent: false, cards: [] }; }
  },
});
export const useSetContinuityConsent = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (granted: boolean) => send(raw.PUT<{ granted: boolean }>(`${BASE}/consent`, { body: { granted, source: "app" } })), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["continuity-cards"] }); } }); };
export const useDismissContinuityCard = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => send(raw.POST<{ dismissed: boolean }>(`${BASE}/cards/${encodeURIComponent(id)}/dismiss`)), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["continuity-cards"] }); } }); };
