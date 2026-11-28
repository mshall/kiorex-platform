import type { Lang } from './i18n';

const loc = (l: Lang) => (l === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
export const fmtMoney = (minor: number, cur: string, l: Lang): string => `${new Intl.NumberFormat(loc(l), { maximumFractionDigits: 0 }).format(Math.round(minor / 100))} ${cur === 'EGP' ? (l === 'ar' ? 'ج.م' : 'EGP') : cur}`;
export const fmtDay = (iso: string, l: Lang, tz: string): string => new Intl.DateTimeFormat(loc(l), { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
export const fmtDayLong = (iso: string, l: Lang, tz: string): string => new Intl.DateTimeFormat(loc(l), { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso));
export const fmtTime = (iso: string, l: Lang, tz: string): string => new Intl.DateTimeFormat(loc(l), { hour: '2-digit', minute: '2-digit', hour12: l === 'en' ? false : true, timeZone: tz }).format(new Date(iso));
/** Calendar-day key in the clinic time zone (YYYY-MM-DD) used to group slots. */
export const dayKey = (iso: string, tz: string): string => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(new Date(iso));
export const fmtClock = (sec: number): string => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
export const name = (p: { nameEn: string | null; nameAr: string | null }, l: Lang): string => (l === 'ar' ? p.nameAr ?? p.nameEn : p.nameEn ?? p.nameAr) ?? '';
