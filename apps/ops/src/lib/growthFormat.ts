import i18n from "@/i18n";

/** Numbers in the Growth console follow the UI language (Latin digits in English, Arabic-Indic digits in Arabic), not the browser locale. */
const loc = () => (i18n.language?.startsWith("ar") ? "ar-EG" : "en-GB");
export const fmtN = (n: number) => new Intl.NumberFormat(loc()).format(n);
export const fmtPct = (n: number, digits = 0) => new Intl.NumberFormat(loc(), { maximumFractionDigits: digits }).format(n) + "%";
