/** Pure helpers of the Kiorly admin Market launch screen (unit tested). Mirrors what the Clinic enforces so a person sees a problem before the round trip. */
export type FormState = { code: string; nameEn: string; nameAr: string; defaultCurrency: string; defaultTimezone: string; defaultLocale: string; defaultPhoneRegion: string; weekendDays: number[]; enabledLanguages: string[]; dataRegion: string; hostCell: string };
export const REGION_CELL: Record<string, string> = { "eu-central-1": "frankfurt", "me-south-1": "cairo" };
export const cellFor = (region: string) => REGION_CELL[region] ?? region;
export const emptyForm = (): FormState => ({ code: "", nameEn: "", nameAr: "", defaultCurrency: "", defaultTimezone: "", defaultLocale: "", defaultPhoneRegion: "", weekendDays: [], enabledLanguages: [], dataRegion: "eu-central-1", hostCell: "frankfurt" });
export type Defaults = { code: string; nameEn: string; nameAr: string; defaultCurrency: string; defaultTimezone: string; defaultLocale: string; defaultPhoneRegion: string; weekendDays: number[]; enabledLanguages: string[] };
export const applyCountry = (f: FormState, code: string, defaults: Defaults[]): FormState => {
  const d = defaults.find((x) => x.code === code);
  return d ? { ...f, ...d, weekendDays: [...d.weekendDays], enabledLanguages: [...d.enabledLanguages] } : { ...emptyForm(), dataRegion: f.dataRegion, hostCell: f.hostCell };
};
export const validTimezone = (tz: string) => { if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false; try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
export type Field = "code" | "nameEn" | "currency" | "timezone" | "locale" | "phoneRegion" | "weekend" | "languages" | "region" | "hostCell";
export function validateForm(f: FormState): Partial<Record<Field, true>> {
  const bad: Partial<Record<Field, true>> = {};
  if (!/^[A-Z]{2}$/.test(f.code.trim().toUpperCase())) bad.code = true;
  if (!f.nameEn.trim() || f.nameEn.trim().length > 200) bad.nameEn = true;
  if (!f.defaultCurrency.trim()) bad.currency = true;
  if (!validTimezone(f.defaultTimezone.trim())) bad.timezone = true;
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(f.defaultLocale.trim())) bad.locale = true;
  if (!/^[A-Z]{2}$/.test(f.defaultPhoneRegion.trim().toUpperCase())) bad.phoneRegion = true;
  if (f.weekendDays.length < 1 || f.weekendDays.length > 3) bad.weekend = true;
  if (f.enabledLanguages.length < 1) bad.languages = true;
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(f.dataRegion.trim())) bad.region = true;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(f.hostCell.trim())) bad.hostCell = true;
  return bad;
}
export const toCreateBody = (f: FormState, reason: string) => ({ code: f.code.trim().toUpperCase(), nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim() || undefined, defaultCurrency: f.defaultCurrency.trim().toUpperCase(), defaultTimezone: f.defaultTimezone.trim(), defaultLocale: f.defaultLocale.trim(), defaultPhoneRegion: f.defaultPhoneRegion.trim().toUpperCase(), weekendDays: [...f.weekendDays].sort((a, b) => a - b), enabledLanguages: [...f.enabledLanguages], dataRegion: f.dataRegion.trim(), hostCell: f.hostCell.trim(), reason: reason.trim() || "Country launch initiated" });

export type Input = { reason: string; approvalRef: string; approvalLink: string; days: string };
export function validateChange(verb: string, i: Input): string | null {
  const reason = i.reason.trim();
  if (reason.length < 3) return "REASON_REQUIRED";
  if (reason.length > 1000) return "REASON_TOO_LONG";
  if (i.approvalRef.trim().length > 128) return "APPROVAL_REF_INVALID";
  if (i.approvalLink.trim()) { try { if (new URL(i.approvalLink.trim()).protocol !== "https:") return "APPROVAL_LINK_INVALID"; } catch { return "APPROVAL_LINK_INVALID"; } }
  if (verb === "pause") { const n = Number(i.days); if (!/^\d+$/.test(i.days.trim()) || n < 1 || n > 365) return "PAUSE_DAYS_INVALID"; }
  return null;
}
export const changeBody = (verb: string, i: Input) => ({ reason: i.reason.trim(), ...(i.approvalRef.trim() ? { approvalRef: i.approvalRef.trim() } : {}), ...(i.approvalLink.trim() ? { approvalLink: i.approvalLink.trim() } : {}), ...(verb === "pause" ? { days: Number(i.days) } : {}) });

/** Which of the four actions a row offers (nothing for a read-only viewer, nothing for a sunset market). */
export function actionsFor(m: { status: string; operability: string }, canChange: boolean): Array<"launch" | "pause" | "disable" | "enable"> {
  if (!canChange) return [];
  if (m.status === "DRAFT") return ["launch"];
  if (m.status !== "LIVE") return [];
  return m.operability === "paused" || m.operability === "disabled" ? ["enable"] : ["pause", "disable"];
}
export const errorCode = (e: unknown): string | null => { const c = (e as { code?: unknown } | null)?.code; return typeof c === "string" ? c : null; };
export const kiorexTone = (k: { known: boolean; live: boolean; state: string }): "success" | "warning" | "neutral" => (k.live ? "success" : k.known ? "warning" : "neutral");
