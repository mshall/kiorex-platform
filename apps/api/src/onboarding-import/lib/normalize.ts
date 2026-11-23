/** Value normalisation + validation (phones default to Egypt, +20). Pure functions; never log inputs. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'; const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));

export function normalizePhone(raw: string | null | undefined, defaultCc = '20'): { value: string | null; valid: boolean; reason?: 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'BAD_PREFIX' } {
  if (!raw || !raw.trim()) return { value: null, valid: false, reason: 'EMPTY' };
  let d = latinDigits(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  let cc = defaultCc; let national: string;
  if (d.startsWith('+')) { const m = /^\+(20|966|971|965|974|973|968|962|961|964|249|218|212|213|216|1|44)(\d+)$/.exec(d); if (!m) return { value: d, valid: false, reason: 'BAD_PREFIX' }; cc = m[1]; national = m[2]; }
  else if (d.startsWith(defaultCc) && d.length >= defaultCc.length + 9) national = d.slice(defaultCc.length);
  else national = d.replace(/^0/, '');
  if (cc === '20') {
    if (national.length < 10) return { value: '+' + cc + national, valid: false, reason: 'TOO_SHORT' };
    if (national.length > 10) return { value: '+' + cc + national, valid: false, reason: 'TOO_LONG' };
    if (!/^1[0125]\d{8}$/.test(national) && !/^[2-9]\d{9}$/.test(national)) return { value: '+' + cc + national, valid: false, reason: 'BAD_PREFIX' };
  } else if (national.length < 7) return { value: '+' + cc + national, valid: false, reason: 'TOO_SHORT' };
  else if (national.length > 12) return { value: '+' + cc + national, valid: false, reason: 'TOO_LONG' };
  return { value: '+' + cc + national, valid: true };
}

export type DateResult = { value: string | null; valid: boolean; ambiguous?: boolean; alt?: string; reason?: 'EMPTY' | 'UNPARSEABLE' | 'OUT_OF_RANGE' | 'FUTURE' };
const iso = (y: number, m: number, d: number) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
/** dayFirst: how to read 03/04/2020. Egypt convention is day-first; flagged as ambiguous when both readings are valid. */
export function parseDate(raw: string | null | undefined, opts: { dayFirst?: boolean; allowFuture?: boolean; now?: Date } = {}): DateResult {
  if (!raw || !raw.trim()) return { value: null, valid: false, reason: 'EMPTY' };
  const s = latinDigits(raw.trim()); const now = opts.now ?? new Date(); const dayFirst = opts.dayFirst ?? true;
  let y: number, m: number, d: number; let m1: RegExpExecArray | null;
  if ((m1 = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
  else if ((m1 = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    const a = +m1[1]; const b = +m1[2]; y = +m1[3]; if (y < 100) y += y > now.getUTCFullYear() % 100 ? 1900 : 2000;
    const first = dayFirst ? { d: a, m: b } : { d: b, m: a }; const second = dayFirst ? { d: b, m: a } : { d: a, m: b };
    const r1 = iso(y, first.m, first.d); const r2 = iso(y, second.m, second.d);
    if (!r1 && !r2) return { value: null, valid: false, reason: 'UNPARSEABLE' };
    const val = r1 ?? r2!; const amb = !!(r1 && r2 && r1 !== r2);
    return check({ value: val, valid: true, ...(amb ? { ambiguous: true, alt: r2! } : {}) }, now, opts.allowFuture);
  } else if (/^\d{5}$/.test(s)) { const dt = new Date(Date.UTC(1899, 11, 30) + +s * 86400000); return check({ value: dt.toISOString().slice(0, 10), valid: true }, now, opts.allowFuture); } // Excel serial
  else return { value: null, valid: false, reason: 'UNPARSEABLE' };
  const v = iso(y, m, d); if (!v) return { value: null, valid: false, reason: 'UNPARSEABLE' };
  return check({ value: v, valid: true }, now, opts.allowFuture);
}
function check(r: DateResult, now: Date, allowFuture?: boolean): DateResult {
  const y = +r.value!.slice(0, 4);
  if (y < 1900) return { ...r, valid: false, reason: 'OUT_OF_RANGE' };
  if (!allowFuture && new Date(r.value! + 'T00:00:00Z').getTime() > now.getTime() + 86400000) return { ...r, valid: false, reason: 'FUTURE' };
  return r;
}

/** Egyptian national id: 14 digits, century digit 2|3, valid birth date, governorate 01-35|88. */
export function parseNationalId(raw: string | null | undefined): { value: string | null; valid: boolean; dob?: string; gender?: 'MALE' | 'FEMALE' } {
  if (!raw) return { value: null, valid: false };
  const d = latinDigits(raw).replace(/\D/g, ''); if (!d) return { value: null, valid: false };
  if (d.length !== 14 || !/^[23]/.test(d)) return { value: d, valid: false };
  const dob = iso((d[0] === '2' ? 1900 : 2000) + +d.slice(1, 3), +d.slice(3, 5), +d.slice(5, 7));
  const gov = +d.slice(7, 9); if (!dob || !((gov >= 1 && gov <= 35) || gov === 88)) return { value: d, valid: false };
  return { value: d, valid: true, dob, gender: +d[12] % 2 === 1 ? 'MALE' : 'FEMALE' };
}

export function normalizeGender(raw: string | null | undefined): 'MALE' | 'FEMALE' | null {
  if (!raw) return null; const s = raw.trim().toLowerCase();
  if (['m', 'male', 'man', '1', 'ذكر', 'ذ', 'رجل'].includes(s)) return 'MALE';
  if (['f', 'female', 'woman', '2', 'أنثى', 'انثى', 'ث', 'أنثي', 'سيدة'].includes(s)) return 'FEMALE';
  return null;
}

/** Name key for matching: Arabic folding (diacritics, alef/yaa/taa-marbuta variants), lowercase, single spaces. */
export function nameKey(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}
export const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
export function splitName(full: string): { first: string; last: string } { const p = full.trim().split(/\s+/); return { first: p[0] ?? '', last: p.slice(1).join(' ') }; }
export const maskPhone = (p: string | null | undefined) => (p ? p.replace(/\d(?=\d{3})/g, '•') : null);
export const maskName = (n: string | null | undefined) => { if (!n) return null; const p = n.trim().split(/\s+/); return p.map((w, i) => (i === 0 ? w : w[0] + '•••')).join(' '); };
