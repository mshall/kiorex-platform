// GRW-P4-C patient hooks (GET/POST /api/v1/growth/v1/corporate/*). Own data only; the server returns no booking, provider or cash balance. The shared openapi-fetch client carries auth and market.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "@/api/client";

type R<D> = Promise<{ data?: D; error?: unknown; response: Response }>;
const raw = api as unknown as { GET<D>(p: string): R<D>; POST<D>(p: string, o: { body: unknown }): R<D> };

export type CorporateMe =
  | { member: false }
  | { member: true; verifiedBy: string; enrolledAt: string; programme: { sponsor: string; endsAt: string | null; currency: string }; allowance: { capMinor: number; usedMinor: number; heldMinor: number; remainingMinor: number } };

export const useCorporateMe = () => useQuery({ queryKey: ["corporate", "me"], retry: 0, queryFn: () => send(raw.GET<CorporateMe>("/api/v1/growth/v1/corporate/me")) });
/** No code means "use my verified work e-mail". The code is never logged or cached. */
export function useJoinCorporate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code?: string) => send(raw.POST<{ member: true; verifiedBy: string }>("/api/v1/growth/v1/corporate/join", { body: code ? { code } : {} })), onSuccess: () => void qc.invalidateQueries({ queryKey: ["corporate"] }) });
}
export function useLeaveCorporate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => send(raw.POST<{ left: boolean }>("/api/v1/growth/v1/corporate/leave", { body: {} })), onSuccess: () => void qc.invalidateQueries({ queryKey: ["corporate"] }) });
}
/** Same rule as the server and the web page: Crockford, 8 to 16 characters, separators ignored, look-alikes mapped. */
export function cleanCorporateCode(v: string): string | null {
  const s = v.normalize("NFKC").toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8,16}$/.test(s) ? s : null;
}
