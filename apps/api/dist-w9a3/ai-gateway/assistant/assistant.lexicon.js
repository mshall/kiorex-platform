"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.partOfHour = exports.isArabic = exports.lexiconIntents = exports.LEXICON_PHRASE_COUNT = void 0;
exports.detectLang = detectLang;
exports.detectDialect = detectDialect;
exports.marketDate = marketDate;
exports.addDays = addDays;
exports.marketHour = marketHour;
exports.analyse = analyse;
exports.namedSpecialties = namedSpecialties;
const safety_public_1 = require("../../safety/safety-public");
const market_time_1 = require("../../common/market-time");
const lexicon_eg_json_1 = __importDefault(require("./model/fixtures/lexicon-eg.json"));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PREFIX = '(?:ال|لل|ب|ل|و|ف)?';
const compile = (phrase) => new RegExp(`(?:^| )${PREFIX}${esc((0, safety_public_1.normalizeText)(phrase))}(?= |$)`);
const INTENTS = Object.fromEntries(Object.entries(lexicon_eg_json_1.default.intents).map(([k, v]) => [k, v.map(compile)]));
const ORDINALS = Object.entries(lexicon_eg_json_1.default.ordinals).map(([n, v]) => [Number(n), v.map(compile)]);
const DISTRICTS = Object.entries(lexicon_eg_json_1.default.districts).map(([k, v]) => [compile(k), v]);
const SPECIALTY_ALIASES = Object.entries(lexicon_eg_json_1.default.specialtyAliases).map(([code, v]) => [code, [...v, code.replace(/_/g, ' '), safety_public_1.SPECIALTY_LABELS[code]?.en ?? '', safety_public_1.SPECIALTY_LABELS[code]?.ar ?? ''].filter(Boolean).map(compile)]);
for (const code of safety_public_1.SPECIALTY_CODES)
    if (!SPECIALTY_ALIASES.some(([c]) => c === code))
        SPECIALTY_ALIASES.push([code, [code.replace(/_/g, ' '), safety_public_1.SPECIALTY_LABELS[code].en, safety_public_1.SPECIALTY_LABELS[code].ar].map(compile)]);
exports.LEXICON_PHRASE_COUNT = Object.values(lexicon_eg_json_1.default.intents).reduce((n, v) => n + v.length, 0);
const lexiconIntents = () => Object.keys(lexicon_eg_json_1.default.intents);
exports.lexiconIntents = lexiconIntents;
const EG_MARKERS = ['عايز', 'عاوز', 'عايزه', 'ازاي', 'النهارده', 'انهارده', 'بكره', 'دلوقتي', 'ايه', 'مش', 'فين', 'كده', 'ده', 'دي', 'احجزلي', 'كنسل', 'ارخص', 'محتاجه', 'عاوزه', 'شوف', 'كلموني', 'ممكن احجز', 'اتكلم'].map(safety_public_1.normalizeText);
const MSA_MARKERS = ['اريد', 'ارغب', 'هل ', 'غدا', 'الان', 'من فضلك', 'لو سمحت', 'اود ', 'يرجي', 'ارجو', 'اطلب', 'بامكاني', 'لدي'].map(safety_public_1.normalizeText);
const isArabic = (s) => /[؀-ۿ]/.test(s);
exports.isArabic = isArabic;
function detectLang(text, fallback) {
    const letters = text.replace(/[^A-Za-z؀-ۿ]/g, '');
    if (!letters)
        return fallback;
    const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    return ar >= latin ? 'ar' : 'en';
}
function detectDialect(text, lang, previous) {
    if (lang === 'en')
        return 'en';
    const n = ` ${(0, safety_public_1.normalizeText)(text)} `;
    const eg = EG_MARKERS.filter((m) => n.includes(` ${m} `) || n.includes(m)).length;
    const msa = MSA_MARKERS.filter((m) => n.includes(m)).length;
    if (msa > eg)
        return 'msa';
    if (eg > msa)
        return 'eg';
    return previous && previous !== 'en' ? previous : 'eg';
}
function marketDate(d = new Date(), zone = (0, market_time_1.marketZone)()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(iso, days) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function marketHour(iso, zone = (0, market_time_1.marketZone)()) { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date(iso))) % 24; }
const partOfHour = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
exports.partOfHour = partOfHour;
function analyse(text, ctx = {}) {
    const n = (0, safety_public_1.normalizeText)(text.replace(/[.,!?؟،:;]/g, ' ')).replace(/\s+/g, ' ');
    const intents = new Set();
    for (const [k, res] of Object.entries(INTENTS))
        if (res.some((r) => r.test(n)))
            intents.add(k);
    const specialties = [];
    for (const [code, res] of SPECIALTY_ALIASES)
        if (res.some((r) => r.test(n)))
            specialties.push(code);
    let area;
    for (const [re, a] of DISTRICTS)
        if (re.test(n)) {
            area = a;
            break;
        }
    const day = intents.has('AFTER_TOMORROW') ? 'after_tomorrow' : intents.has('TOMORROW') ? 'tomorrow' : intents.has('TODAY') ? 'today' : undefined;
    const part = intents.has('MORNING') ? 'morning' : intents.has('AFTERNOON') ? 'afternoon' : intents.has('EVENING') ? 'evening' : undefined;
    let maxPriceMinor;
    const pm = /(?:تحت|اقل من|لحد|حتي|under|below|less than|max|up to|في حدود|بحد اقصي)\s*(\d{2,5})|(\d{2,5})\s*(?:جنيه|جنيها|egp|pounds|le)\b/.exec(n);
    if (pm)
        maxPriceMinor = Number(pm[1] ?? pm[2]) * 100;
    let pick;
    const bare = /^(?:رقم |number |no |# )?(\d{1,2})$/.exec(n.trim());
    if (bare)
        pick = Number(bare[1]);
    else
        for (const [num, res] of ORDINALS)
            if (res.some((r) => r.test(n)) && n.split(' ').length <= 4) {
                pick = num;
                break;
            }
    const lang = detectLang(text, ctx.lang ?? 'ar');
    return { intents, specialties, area, day, part, cheapest: intents.has('CHEAPEST'), nearest: intents.has('NEAREST'), maxPriceMinor, pick, lang, dialect: detectDialect(text, lang, ctx.dialect), normalised: n };
}
function namedSpecialties(text, shownSpecialties = []) {
    const f = analyse(text);
    const out = new Set(f.specialties);
    if (f.pick && shownSpecialties[f.pick - 1] && (0, safety_public_1.isSpecialtyCode)(shownSpecialties[f.pick - 1]))
        out.add(shownSpecialties[f.pick - 1]);
    return [...out];
}
//# sourceMappingURL=assistant.lexicon.js.map