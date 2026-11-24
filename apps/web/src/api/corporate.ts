// GRW-P4-C patient hooks over /api/v1/growth/v1/corporate/*. Own data only: nothing here names another person, and the server returns no booking, provider or balance.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toApiError } from "./errors";
import { useAuth } from "@/auth/AuthProvider";

export type CorporateMe =
  | { member: false }
  | { member: true; verifiedBy: "CODE" | "HR_LIST" | "DOMAIN_EMAIL"; enrolledAt: string; programme: { sponsor: string; endsAt: string | null; currency: string }; allowance: { capMinor: number; usedMinor: number; heldMinor: number; remainingMinor: number } };
export interface CorporateJoined { member: true; verifiedBy: string; programme: { sponsor: string; endsAt: string | null } }

async function call<T>(token: string | null, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${window.location.origin}/api/v1${path}`, { method, headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw toApiError(r.status, json);
  return json as T;
}

export function useCorporateMe() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["corporate", "me"], retry: 0, queryFn: () => call<CorporateMe>(user?.token ?? null, "GET", "/growth/v1/corporate/me") });
}
/** `code` empty or missing means "use my verified work e-mail". The code is never logged or cached. */
export function useJoinCorporate() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: (code?: string) => call<CorporateJoined>(user?.token ?? null, "POST", "/growth/v1/corporate/join", code ? { code } : {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ["corporate"] }) });
}
export function useLeaveCorporate() {
  const { user } = useAuth(); const qc = useQueryClient();
  return useMutation({ mutationFn: () => call<{ left: boolean }>(user?.token ?? null, "POST", "/growth/v1/corporate/leave", {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ["corporate"] }) });
}
/** Crockford code, 8 to 16 characters, hyphens and spaces ignored, look-alikes mapped (same rule as the server). Returns the cleaned code or null. */
export function cleanCorporateCode(v: string): string | null {
  const s = v.normalize("NFKC").toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8,16}$/.test(s) ? s : null;
}
