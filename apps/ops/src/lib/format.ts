const loc = (lang: string) => (lang.startsWith("ar") ? "ar-EG" : "en-GB");
export const formatDateTime = (iso: string | null | undefined, lang: string) =>
  iso ? new Intl.DateTimeFormat(loc(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(iso)) : "—";
export const formatEgp = (n: number, lang: string) => new Intl.NumberFormat(loc(lang), { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
export const formatAge = (sec: number | null | undefined) => (sec == null ? "—" : sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`);
/** `<input type=datetime-local>` value → ISO (or undefined). */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : undefined);
