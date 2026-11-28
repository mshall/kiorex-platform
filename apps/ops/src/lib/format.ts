const loc = (lang: string) => (lang.startsWith("ar") ? "ar-EG" : "en-GB");
/** Date and time are formatted separately and joined with a middle dot: avoids the stray leading comma Arabic bidi produces for a combined string. */
export const formatDateTime = (iso: string | null | undefined, lang: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(loc(lang), { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" }).format(d);
  const time = new Intl.DateTimeFormat(loc(lang), { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" }).format(d);
  return `${date} · ${time}`;
};
export const formatEgp = (n: number, lang: string) => new Intl.NumberFormat(loc(lang), { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
export const formatAge = (sec: number | null | undefined) => (sec == null ? "—" : sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`);
/** `<input type=datetime-local>` value → ISO (or undefined). */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : undefined);
/** Money on the wire is integer minor units (piastres). */
export const formatMinor = (minor: number, lang: string, currency = "EGP") =>
  new Intl.NumberFormat(loc(lang), { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
export const formatBps = (bps: number, lang: string) => new Intl.NumberFormat(loc(lang), { style: "percent", maximumFractionDigits: 2 }).format(bps / 10_000);
/** CSV for an accountant (own statement export). Quotes every cell; guards against spreadsheet formula injection. */
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => { const s = String(c); return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; }).join(",")).join("\r\n");

/** "internal_medicine" -> "Internal medicine": machine codes (specialty, status keys) read as words in tables. Anything with spaces or capitals is left alone. */
export function humanizeCode(v: string | null | undefined): string {
  if (!v) return "—";
  if (!/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(v) && !/^[a-z0-9]+$/.test(v)) return v;
  if (/^[a-z]{2,3}$/.test(v)) return v.toUpperCase(); // ent, ob, gp
  const s = v.replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
