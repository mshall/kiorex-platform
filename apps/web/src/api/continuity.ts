// GRW-P4-A: the patient's own continuity cards (clinic visit -> pharmacy, lab, home visit). Endpoints: GET /api/v1/growth/v1/continuity/cards, GET/PUT .../consent, POST .../cards/:id/dismiss
// (not in the generated client yet). With the flag OFF or locked the API answers `{ enabled:false, cards:[] }` (or 403/404) and every surface looks exactly as before.
// Nothing here sends a name, phone, e-mail, item or test name: only the card id travels back, in a header on the order, booking or care-plan request the patient chooses to make.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";

export type ContinuityKind = "RX_TO_PHARMACY" | "LAB_ORDER_TO_LAB" | "CARE_PLAN_TO_HOME_VISIT";
export interface ContinuityCard { id: string; kind: ContinuityKind; toProduct: "PHARMACY" | "LAB" | "NURSE"; expiresAt: string; recordId?: string; path: string }
export interface ContinuityCards { enabled: boolean; consent: boolean; cards: ContinuityCard[] }
export interface ContinuityConsent { granted: boolean; textVersion: string | null; draftWording: boolean }

const BASE = "/api/v1/growth/v1/continuity";
export const CONTINUITY_HEADER = "X-Kx-Continuity";
const STORE = "kx-continuity";
const TTL_MS = 30 * 60_000;
/** Requests that can follow a continuity card: the pharmacy order, the lab booking and the care-plan request. */
export const CONTINUITY_PATHS: readonly string[] = ["/api/v1/pharmacy/orders", "/api/v1/lab/bookings", "/api/v1/care-plans"];

/** The card the patient just opened, kept for 30 minutes in this tab only (sessionStorage; never persisted across sessions). */
export function rememberCard(id: string, now = Date.now()) { try { sessionStorage.setItem(STORE, JSON.stringify({ id, at: now })); } catch { /* storage blocked: the order is then simply independent */ } }
export function currentCard(now = Date.now()): string | null {
  try { const v = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as { id?: string; at?: number } | null; return v?.id && typeof v.at === "number" && now - v.at < TTL_MS && /^[A-Za-z0-9_-]{10,40}$/.test(v.id) ? v.id : null; } catch { return null; }
}
export function clearCard() { try { sessionStorage.removeItem(STORE); } catch { /* */ } }

async function call<T>(token: string | undefined, path: string, init: RequestInit = {}): Promise<T | null> {
  const r = await fetch(`${window.location.origin}${BASE}${path}`, { ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) return null; // flag OFF or locked (403), not found, or an outage: nothing is shown, nothing blocks
  return (await r.json().catch(() => null)) as T | null;
}

export function useContinuityCards() {
  const { user, status } = useAuth();
  return useQuery({ queryKey: ["continuity-cards"], enabled: status === "signedIn", staleTime: 60_000, retry: false, queryFn: async (): Promise<ContinuityCards> => {
    const r = await call<ContinuityCards>(user?.token, "/cards");
    return r && r.enabled && Array.isArray(r.cards) ? r : { enabled: false, consent: false, cards: [] };
  } });
}
export function useSetContinuityConsent() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (granted: boolean) => call<ContinuityConsent>(user?.token, "/consent", { method: "PUT", body: JSON.stringify({ granted, source: "web" }) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["continuity-cards"] }); } });
}
export function useDismissContinuityCard() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => call(user?.token, `/cards/${encodeURIComponent(id)}/dismiss`, { method: "POST" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["continuity-cards"] }); } });
}
