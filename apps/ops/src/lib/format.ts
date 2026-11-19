const loc = (lang: string) => (lang.startsWith("ar") ? "ar-EG" : "en-GB");
export const formatDateTime = (iso: string | null | undefined, lang: string) =>
  iso ? new Intl.DateTimeFormat(loc(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(iso)) : "—";
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
