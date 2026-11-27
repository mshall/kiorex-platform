/** Pure helpers of the Plans screen (unit tested). Mirrors what the Clinic and the API enforce so a person sees a problem before the round trip. */
import type { ClinicMarket, ClinicPrice, ContentConfig, ContentPlan } from "@/api/kiorlyPlans";

export type PriceState = "active" | "scheduled" | "past";
export const priceState = (p: Pick<ClinicPrice, "validFrom" | "validTo">, now = new Date()): PriceState =>
  new Date(p.validFrom) > now ? "scheduled" : p.validTo && new Date(p.validTo) <= now ? "past" : "active";

/** Prices of one plan, newest version first within a market, cohort prices (founding lock) listed last. */
export const sortPrices = (prices: ClinicPrice[]): ClinicPrice[] =>
  [...prices].sort((a, b) => (a.cohortKey ? 1 : 0) - (b.cohortKey ? 1 : 0) || a.marketId.localeCompare(b.marketId) || a.interval.localeCompare(b.interval) || b.priceVersion - a.priceVersion);

export interface PriceForm { marketId: string; currency: string; interval: "MONTHLY" | "ANNUAL"; unit: "PER_TENANT" | "PER_CLINICIAN"; amount: string; includedClinicians: string; extraClinicianAmount: string; validFrom: string }
export const emptyPriceForm = (m?: ClinicMarket): PriceForm => ({ marketId: m?.id ?? "", currency: m?.defaultCurrency ?? "", interval: "MONTHLY", unit: "PER_TENANT", amount: "", includedClinicians: "1", extraClinicianAmount: "", validFrom: "" });
export type PriceField = "market" | "currency" | "amount" | "included" | "extra" | "validFrom";
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
export function validatePrice(f: PriceForm): Partial<Record<PriceField, true>> {
  const bad: Partial<Record<PriceField, true>> = {};
  if (!f.marketId) bad.market = true;
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) bad.currency = true;
  if (!MONEY.test(f.amount.trim())) bad.amount = true;
  if (!/^\d{1,3}$/.test(f.includedClinicians.trim()) || Number(f.includedClinicians) < 1) bad.included = true;
  if (f.extraClinicianAmount.trim() && !MONEY.test(f.extraClinicianAmount.trim())) bad.extra = true;
  if (f.validFrom && Number.isNaN(new Date(f.validFrom).getTime())) bad.validFrom = true;
  return bad;
}
export const toPriceBody = (f: PriceForm, preview: boolean) => ({
  marketId: f.marketId, currency: f.currency.trim().toUpperCase(), interval: f.interval, unit: f.unit, amount: f.amount.trim(), includedClinicians: Number(f.includedClinicians),
  ...(f.extraClinicianAmount.trim() ? { extraClinicianAmount: f.extraClinicianAmount.trim() } : {}),
  ...(f.validFrom ? { validFrom: new Date(f.validFrom).toISOString() } : {}),
  ...(preview ? { preview: true } : {}),
});

/** One line per entry in the editor, a list in the document. Blank lines are dropped. */
export const linesToList = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);
export const listToLines = (a: string[]): string => a.join("\n");

export type ContentIssue = "name" | "lines" | "markup" | "length" | "count";
export function contentIssues(p: ContentPlan): ContentIssue[] {
  const out = new Set<ContentIssue>();
  const all = [p.name.en, p.name.ar, p.summary.en, p.summary.ar, ...p.limits.en, ...p.limits.ar, ...p.features.en, ...p.features.ar];
  if (!p.name.en.trim() || !p.name.ar.trim()) out.add("name");
  if (p.limits.en.length !== p.limits.ar.length || p.features.en.length !== p.features.ar.length) out.add("lines");
  if (all.some((x) => /[<>]/.test(x))) out.add("markup");
  if (all.some((x) => x.length > 200)) out.add("length");
  if (p.limits.en.length > 14 || p.features.en.length > 14 || p.limits.ar.length > 14 || p.features.ar.length > 14) out.add("count");
  return [...out];
}
export const contentValid = (c: ContentConfig) => [...c.pharmacy.plans, ...c.lab.plans].every((p) => contentIssues(p).length === 0);
export const contentChanged = (a: ContentConfig, b: ContentConfig) => JSON.stringify(a) !== JSON.stringify(b);
export const cleanContent = (c: ContentConfig): ContentConfig => JSON.parse(JSON.stringify(c, (_k, v) => (typeof v === "string" ? v.trim() : v)));
