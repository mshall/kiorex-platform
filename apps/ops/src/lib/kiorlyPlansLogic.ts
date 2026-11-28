/** Pure helpers of the Plans screen (unit tested). Mirrors what the Clinic and the API enforce so a person sees a problem before the round trip. */
import type { ClinicMarket, ClinicPrice, ContentConfig, ContentPlan, PriceProduct, PriceProposal } from "@/api/kiorlyPlans";

export type PriceState = "active" | "scheduled" | "past";
export const priceState = (p: Pick<ClinicPrice, "validFrom" | "validTo">, now = new Date()): PriceState =>
  new Date(p.validFrom) > now ? "scheduled" : p.validTo && new Date(p.validTo) <= now ? "past" : "active";

/** Prices of one plan, newest version first within a market, cohort prices (founding lock) listed last. */
export const sortPrices = (prices: ClinicPrice[]): ClinicPrice[] =>
  [...prices].sort((a, b) => (a.cohortKey ? 1 : 0) - (b.cohortKey ? 1 : 0) || a.marketId.localeCompare(b.marketId) || a.interval.localeCompare(b.interval) || b.priceVersion - a.priceVersion);

/** Dates for the price screens: Western digits in both languages (the numerals rule), shown in the Cairo time of the business. */
export const formatWhen = (iso: string | null | undefined, lang: string): string => {
  if (!iso) return "-";
  const d = new Date(iso); const l = lang.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return `${new Intl.DateTimeFormat(l, { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" }).format(d)} · ${new Intl.DateTimeFormat(l, { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" }).format(d)}`;
};

/** The form of a price PROPOSAL (any product). Pharmacy and Lab prices are per organisation; only the Clinic has a unit and clinician fields. */
export interface ProposalForm { product: PriceProduct; planRef: string; marketCode: string; currency: string; interval: "MONTHLY" | "ANNUAL"; unit: "PER_TENANT" | "PER_CLINICIAN"; amount: string; includedClinicians: string; extraClinicianAmount: string; validFrom: string; note: string }
export const emptyProposalForm = (product: PriceProduct, planRef: string, market?: Pick<ClinicMarket, "code" | "defaultCurrency">): ProposalForm => ({ product, planRef, marketCode: market?.code ?? "EG", currency: market?.defaultCurrency ?? "", interval: "MONTHLY", unit: "PER_TENANT", amount: "", includedClinicians: "1", extraClinicianAmount: "", validFrom: "", note: "" });
export type ProposalField = "market" | "currency" | "amount" | "included" | "extra" | "validFrom";
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
export function validateProposal(f: ProposalForm): Partial<Record<ProposalField, true>> {
  const bad: Partial<Record<ProposalField, true>> = {};
  if (!/^[A-Za-z]{2}$/.test(f.marketCode.trim())) bad.market = true;
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) bad.currency = true;
  if (!MONEY.test(f.amount.trim())) bad.amount = true;
  if (f.product === "CLINIC") {
    if (!/^\d{1,3}$/.test(f.includedClinicians.trim()) || Number(f.includedClinicians) < 1) bad.included = true;
    if (f.extraClinicianAmount.trim() && !MONEY.test(f.extraClinicianAmount.trim())) bad.extra = true;
  }
  if (f.validFrom && Number.isNaN(new Date(f.validFrom).getTime())) bad.validFrom = true;
  return bad;
}
export const toProposalBody = (f: ProposalForm) => ({
  product: f.product, planRef: f.planRef, marketCode: f.marketCode.trim().toUpperCase(), currency: f.currency.trim().toUpperCase(), interval: f.interval, amount: f.amount.trim(),
  ...(f.product === "CLINIC" ? { unit: f.unit, includedClinicians: Number(f.includedClinicians), ...(f.extraClinicianAmount.trim() ? { extraClinicianAmount: f.extraClinicianAmount.trim() } : {}) } : {}),
  ...(f.validFrom ? { validFrom: new Date(f.validFrom).toISOString() } : {}),
  ...(f.note.trim() ? { note: f.note.trim() } : {}),
});

/** What a person may do with one proposal: the proposer withdraws, a different super admin decides, nobody touches a decided one (the API and the database repeat every rule). */
export function proposalActions(p: Pick<PriceProposal, "status" | "proposedBy">, caps: { canApprove: boolean; you: string } | undefined): { approve: boolean; reject: boolean; withdraw: boolean; ownPending: boolean } {
  const pending = p.status === "PENDING"; const mine = !!caps && p.proposedBy === caps.you;
  return { approve: pending && !mine && !!caps?.canApprove, reject: pending && !mine && !!caps?.canApprove, withdraw: pending && mine, ownPending: pending && mine && !!caps?.canApprove };
}

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
