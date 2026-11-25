"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_GEOGRAPHY_ROWS = void 0;
exports.decodeCsv = decodeCsv;
exports.readCsv = readCsv;
exports.parseGeography = parseGeography;
const slug_1 = require("../slugs/slug");
const arabic_1 = require("../seo/arabic");
exports.MAX_GEOGRAPHY_ROWS = 20_000;
const BIDI = /[‎‏‪-‮⁦-⁩​-‍﻿]/;
const CTRL = /[\u0000-\u001F\u007F]/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FORMULA = /^[=+\-@]/;
const HEADERS = { level: 'level', key: 'key', parentkey: 'parentKey', parent: 'parentKey', namear: 'nameAr', name_ar: 'nameAr', nameen: 'nameEn', name_en: 'nameEn', slugar: 'slugAr', slug_ar: 'slugAr', slugen: 'slugEn', slug_en: 'slugEn' };
function decodeCsv(input) {
    let text;
    if (input.base64 !== undefined) {
        const buf = Buffer.from(input.base64, 'base64');
        if (input.encoding === 'windows-1256')
            text = new TextDecoder('windows-1256').decode(buf);
        else {
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
            }
            catch {
                return { error: { line: 0, code: 'ENCODING_NOT_UTF8', message: 'The file is not UTF-8. Save it as UTF-8, or send it with encoding windows-1256.' } };
            }
        }
    }
    else
        text = input.text ?? '';
    if (text.includes('�'))
        return { error: { line: 0, code: 'ENCODING_NOT_UTF8', message: 'The text contains replacement characters: the file was decoded with the wrong encoding.' } };
    return { text: text.replace(/^﻿/, '') };
}
function readCsv(text) {
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const out = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                cell += ch;
            continue;
        }
        if (ch === '"' && cell === '')
            q = true;
        else if (ch === delim) {
            row.push(cell);
            cell = '';
        }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n')
                i++;
            row.push(cell);
            cell = '';
            if (row.some((c) => c.trim() !== ''))
                out.push(row);
            row = [];
        }
        else
            cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim() !== ''))
        out.push(row);
    return out;
}
function parseGeography(text) {
    const errors = [];
    const err = (line, code, message) => { if (errors.length < 200)
        errors.push({ line, code, message }); };
    const table = readCsv(text);
    const rows = [];
    if (!table.length) {
        err(0, 'EMPTY', 'The file has no rows.');
        return { rows, errors, cities: 0, districts: 0, totalLines: 0, truncatedErrors: false };
    }
    const head = table[0].map((h) => HEADERS[h.trim().toLowerCase().replace(/[\s-]/g, '')]);
    for (const need of ['level', 'nameAr', 'nameEn'])
        if (!head.includes(need))
            err(1, 'HEADER_MISSING', `The header needs a ${need} column.`);
    if (errors.length)
        return { rows, errors, cities: 0, districts: 0, totalLines: table.length - 1, truncatedErrors: false };
    const data = table.slice(1);
    if (data.length > exports.MAX_GEOGRAPHY_ROWS) {
        err(0, 'TOO_MANY_ROWS', `At most ${exports.MAX_GEOGRAPHY_ROWS} rows per import (this file has ${data.length}).`);
        return { rows, errors, cities: 0, districts: 0, totalLines: data.length, truncatedErrors: false };
    }
    const keys = new Set();
    const slugAr = new Map();
    const slugEn = new Map();
    const cityKeys = new Set();
    const pendingDistricts = [];
    data.forEach((cells, idx) => {
        const line = idx + 2;
        const g = {};
        head.forEach((h, c) => { if (h)
            g[h] = (cells[c] ?? '').normalize('NFC').trim(); });
        for (const f of ['nameAr', 'nameEn', 'key', 'parentKey', 'slugAr', 'slugEn']) {
            const v = g[f] ?? '';
            if (BIDI.test(v) || CTRL.test(v)) {
                err(line, 'BAD_CHARACTER', `${f} contains a control or direction override character.`);
                return;
            }
        }
        const level = (g.level ?? '').toUpperCase();
        if (level !== 'CITY' && level !== 'DISTRICT') {
            err(line, 'LEVEL', 'level must be CITY or DISTRICT.');
            return;
        }
        if (!g.nameAr || !g.nameEn || g.nameAr.length > 120 || g.nameEn.length > 120) {
            err(line, 'NAME', 'nameAr and nameEn are required, at most 120 characters.');
            return;
        }
        if (FORMULA.test(g.nameAr) || FORMULA.test(g.nameEn)) {
            err(line, 'FORMULA', 'A name must not start with = + - or @ (spreadsheet formula).');
            return;
        }
        const en = g.slugEn || (0, slug_1.slugify)(g.nameEn);
        const ar = g.slugAr || (0, slug_1.slugify)((0, arabic_1.transliterateArabic)(g.nameAr));
        if (!slug_1.SLUG_PATTERN.test(en) || !slug_1.SLUG_PATTERN.test(ar)) {
            err(line, 'SLUG', 'A slug must be 3 to 60 characters of a-z, 0-9 and hyphen; give slugAr and slugEn explicitly.');
            return;
        }
        const key = g.key || en;
        if (!KEY.test(key)) {
            err(line, 'KEY', 'key must be lower case a-z, 0-9, hyphen or underscore.');
            return;
        }
        const k = `${level}:${key}`;
        if (keys.has(k)) {
            err(line, 'DUPLICATE_KEY', `Duplicate ${level.toLowerCase()} key "${key}".`);
            return;
        }
        const a = `${level}:${ar}`;
        const e = `${level}:${en}`;
        if (slugAr.has(a)) {
            err(line, 'DUPLICATE_SLUG', `Arabic slug "${ar}" is already used by ${slugAr.get(a)}.`);
            return;
        }
        if (slugEn.has(e)) {
            err(line, 'DUPLICATE_SLUG', `English slug "${en}" is already used by ${slugEn.get(e)}.`);
            return;
        }
        keys.add(k);
        slugAr.set(a, key);
        slugEn.set(e, key);
        if (level === 'CITY') {
            if (g.parentKey) {
                err(line, 'PARENT', 'A city has no parentKey.');
                return;
            }
            cityKeys.add(key);
            rows.push({ level, key, parentKey: '', nameAr: g.nameAr, nameEn: g.nameEn, slugAr: ar, slugEn: en });
        }
        else {
            if (!g.parentKey) {
                err(line, 'PARENT', 'A district needs the key of its city in parentKey.');
                return;
            }
            pendingDistricts.push({ line, parent: g.parentKey });
            rows.push({ level, key, parentKey: g.parentKey, nameAr: g.nameAr, nameEn: g.nameEn, slugAr: ar, slugEn: en });
        }
    });
    for (const d of pendingDistricts)
        if (!cityKeys.has(d.parent))
            err(d.line, 'PARENT_UNKNOWN', `The city "${d.parent}" is not in the file.`);
    const bad = errors.length > 0;
    return { rows: bad ? [] : rows, errors, cities: rows.filter((r) => r.level === 'CITY').length, districts: rows.filter((r) => r.level === 'DISTRICT').length, totalLines: data.length, truncatedErrors: errors.length >= 200 };
}
//# sourceMappingURL=geography-csv.js.map