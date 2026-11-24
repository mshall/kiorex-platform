import { slugify, SLUG_PATTERN } from '../slugs/slug';
import { transliterateArabic } from '../seo/arabic';

/**
 * GRW-P3-G geography CSV: cities and districts of a new market. PURE. Rejects what would corrupt a public URL or a console table: bytes that are not UTF-8, direction overrides
 * and control characters in names, spreadsheet formulas, duplicate keys and duplicate slugs per locale, a district without its city, and more than 20,000 rows.
 * Columns (any order, comma, semicolon or tab): level, key, parentKey, nameAr, nameEn, slugAr, slugEn. key and the slugs are derived when empty.
 */
export const MAX_GEOGRAPHY_ROWS = 20_000;
export interface GeoRow { level: 'CITY' | 'DISTRICT'; key: string; parentKey: string; nameAr: string; nameEn: string; slugAr: string; slugEn: string }
export interface GeoError { line: number; code: string; message: string }
export interface GeoParse { rows: GeoRow[]; errors: GeoError[]; cities: number; districts: number; totalLines: number; truncatedErrors: boolean }

const BIDI = /[‎‏‪-‮⁦-⁩​-‍﻿]/;
const CTRL = /[\u0000-\u001F\u007F]/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FORMULA = /^[=+\-@]/;
const HEADERS: Record<string, keyof GeoRow> = { level: 'level', key: 'key', parentkey: 'parentKey', parent: 'parentKey', namear: 'nameAr', name_ar: 'nameAr', nameen: 'nameEn', name_en: 'nameEn', slugar: 'slugAr', slug_ar: 'slugAr', slugen: 'slugEn', slug_en: 'slugEn' };

/** Decodes uploaded bytes: UTF-8 (with or without BOM) or, when declared, windows-1256 (the Arabic Excel export). Anything else with replacement characters is refused, never guessed. */
export function decodeCsv(input: { text?: string; base64?: string; encoding?: string }): { text: string } | { error: GeoError } {
  let text: string;
  if (input.base64 !== undefined) {
    const buf = Buffer.from(input.base64, 'base64');
    if (input.encoding === 'windows-1256') text = new TextDecoder('windows-1256').decode(buf);
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return { error: { line: 0, code: 'ENCODING_NOT_UTF8', message: 'The file is not UTF-8. Save it as UTF-8, or send it with encoding windows-1256.' } }; } }
  } else text = input.text ?? '';
  if (text.includes('�')) return { error: { line: 0, code: 'ENCODING_NOT_UTF8', message: 'The text contains replacement characters: the file was decoded with the wrong encoding.' } };
  return { text: text.replace(/^﻿/, '') };
}

/** RFC 4180 reader with quotes and embedded newlines; the delimiter is detected from the header line. */
export function readCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const out: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) out.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) out.push(row);
  return out;
}

export function parseGeography(text: string): GeoParse {
  const errors: GeoError[] = []; const err = (line: number, code: string, message: string) => { if (errors.length < 200) errors.push({ line, code, message }); };
  const table = readCsv(text); const rows: GeoRow[] = [];
  if (!table.length) { err(0, 'EMPTY', 'The file has no rows.'); return { rows, errors, cities: 0, districts: 0, totalLines: 0, truncatedErrors: false }; }
  const head = table[0]!.map((h) => HEADERS[h.trim().toLowerCase().replace(/[\s-]/g, '')]);
  for (const need of ['level', 'nameAr', 'nameEn'] as const) if (!head.includes(need)) err(1, 'HEADER_MISSING', `The header needs a ${need} column.`);
  if (errors.length) return { rows, errors, cities: 0, districts: 0, totalLines: table.length - 1, truncatedErrors: false };
  const data = table.slice(1);
  if (data.length > MAX_GEOGRAPHY_ROWS) { err(0, 'TOO_MANY_ROWS', `At most ${MAX_GEOGRAPHY_ROWS} rows per import (this file has ${data.length}).`); return { rows, errors, cities: 0, districts: 0, totalLines: data.length, truncatedErrors: false }; }
  const keys = new Set<string>(); const slugAr = new Map<string, string>(); const slugEn = new Map<string, string>(); const cityKeys = new Set<string>(); const pendingDistricts: { line: number; parent: string }[] = [];
  data.forEach((cells, idx) => {
    const line = idx + 2; const g: Record<string, string> = {};
    head.forEach((h, c) => { if (h) g[h] = (cells[c] ?? '').normalize('NFC').trim(); });
    for (const f of ['nameAr', 'nameEn', 'key', 'parentKey', 'slugAr', 'slugEn']) { const v = g[f] ?? ''; if (BIDI.test(v) || CTRL.test(v)) { err(line, 'BAD_CHARACTER', `${f} contains a control or direction override character.`); return; } }
    const level = (g.level ?? '').toUpperCase();
    if (level !== 'CITY' && level !== 'DISTRICT') { err(line, 'LEVEL', 'level must be CITY or DISTRICT.'); return; }
    if (!g.nameAr || !g.nameEn || g.nameAr.length > 120 || g.nameEn.length > 120) { err(line, 'NAME', 'nameAr and nameEn are required, at most 120 characters.'); return; }
    if (FORMULA.test(g.nameAr) || FORMULA.test(g.nameEn)) { err(line, 'FORMULA', 'A name must not start with = + - or @ (spreadsheet formula).'); return; }
    const en = g.slugEn || slugify(g.nameEn); const ar = g.slugAr || slugify(transliterateArabic(g.nameAr));
    if (!SLUG_PATTERN.test(en) || !SLUG_PATTERN.test(ar)) { err(line, 'SLUG', 'A slug must be 3 to 60 characters of a-z, 0-9 and hyphen; give slugAr and slugEn explicitly.'); return; }
    const key = g.key || en; if (!KEY.test(key)) { err(line, 'KEY', 'key must be lower case a-z, 0-9, hyphen or underscore.'); return; }
    const k = `${level}:${key}`;
    if (keys.has(k)) { err(line, 'DUPLICATE_KEY', `Duplicate ${level.toLowerCase()} key "${key}".`); return; }
    const a = `${level}:${ar}`; const e = `${level}:${en}`;
    if (slugAr.has(a)) { err(line, 'DUPLICATE_SLUG', `Arabic slug "${ar}" is already used by ${slugAr.get(a)}.`); return; }
    if (slugEn.has(e)) { err(line, 'DUPLICATE_SLUG', `English slug "${en}" is already used by ${slugEn.get(e)}.`); return; }
    keys.add(k); slugAr.set(a, key); slugEn.set(e, key);
    if (level === 'CITY') { if (g.parentKey) { err(line, 'PARENT', 'A city has no parentKey.'); return; } cityKeys.add(key); rows.push({ level, key, parentKey: '', nameAr: g.nameAr, nameEn: g.nameEn, slugAr: ar, slugEn: en }); }
    else { if (!g.parentKey) { err(line, 'PARENT', 'A district needs the key of its city in parentKey.'); return; } pendingDistricts.push({ line, parent: g.parentKey }); rows.push({ level, key, parentKey: g.parentKey, nameAr: g.nameAr, nameEn: g.nameEn, slugAr: ar, slugEn: en }); }
  });
  for (const d of pendingDistricts) if (!cityKeys.has(d.parent)) err(d.line, 'PARENT_UNKNOWN', `The city "${d.parent}" is not in the file.`);
  const bad = errors.length > 0;
  return { rows: bad ? [] : rows, errors, cities: rows.filter((r) => r.level === 'CITY').length, districts: rows.filter((r) => r.level === 'DISTRICT').length, totalLines: data.length, truncatedErrors: errors.length >= 200 };
}
