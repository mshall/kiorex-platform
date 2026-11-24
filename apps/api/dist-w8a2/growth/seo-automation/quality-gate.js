"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentHashOf = void 0;
exports.boilerplateOf = boilerplateOf;
exports.runGate = runGate;
exports.summarise = summarise;
const node_crypto_1 = require("node:crypto");
const checks_1 = require("./checks");
const parity_ar_en_1 = require("./checks/parity-ar-en");
const page_model_1 = require("./page-model");
const text_1 = require("./text");
const BOILERPLATE_SHARE = 0.6;
const BOILERPLATE_MIN_PAGES = 5;
function boilerplateOf(pages, n) {
    const out = new Set();
    if (pages.length < BOILERPLATE_MIN_PAGES)
        return out;
    const df = new Map();
    for (const p of pages)
        for (const s of (0, text_1.shingles)((0, text_1.tokens)(p.text), n))
            df.set(s, (df.get(s) ?? 0) + 1);
    for (const [s, c] of df)
        if (c / pages.length >= BOILERPLATE_SHARE)
            out.add(s);
    return out;
}
const contentHashOf = (p) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([p.title, p.description, p.h1, p.text, p.jsonLd, p.canonical, p.alternates, p.robots])).digest('hex').slice(0, 32);
exports.contentHashOf = contentHashOf;
function runGate(input) {
    const { cfg } = input;
    const pages = new Map(input.pages.map((p) => [(0, page_model_1.pageId)(p.pageKey, p.locale), p]));
    const groups = new Map();
    for (const p of input.pages) {
        const g = `${p.templateKind}|${p.locale}`;
        groups.set(g, [...(groups.get(g) ?? []), p]);
    }
    const boiler = new Map([...groups].map(([g, ps]) => [g, boilerplateOf(ps, 3)]));
    const uniqueTokens = new Map();
    const uniq = (p) => {
        const id = (0, page_model_1.pageId)(p.pageKey, p.locale);
        const hit = uniqueTokens.get(id);
        if (hit)
            return hit;
        const toks = (0, text_1.tokens)(p.text);
        const b = boiler.get(`${p.templateKind}|${p.locale}`);
        let out = toks;
        if (b.size) {
            const covered = new Array(toks.length).fill(false);
            for (let i = 0; i + 3 <= toks.length; i++)
                if (b.has(toks.slice(i, i + 3).join(' '))) {
                    covered[i] = covered[i + 1] = covered[i + 2] = true;
                }
            out = toks.filter((_, i) => !covered[i]);
        }
        uniqueTokens.set(id, out);
        return out;
    };
    const sh = new Map();
    const owners = (field, locale) => {
        const m = new Map();
        for (const p of input.pages)
            if (p.locale === locale && p[field])
                m.set(p[field], [...(m.get(p[field]) ?? []), p.pageKey]);
        return m;
    };
    const titles = { ar: owners('title', 'ar'), en: owners('title', 'en') };
    const descs = { ar: owners('description', 'ar'), en: owners('description', 'en') };
    const ctxFor = (locale) => ({
        cfg, host: input.host, reviewMarkupEnabled: input.reviewMarkupEnabled, reviewMarkupMinCount: input.reviewMarkupMinCount, minAvailableProviders: input.minAvailableProviders, pages,
        uniqueShingles: (p) => { const id = (0, page_model_1.pageId)(p.pageKey, p.locale); let s = sh.get(id); if (!s) {
            s = (0, text_1.shingles)(uniq(p), cfg.shingleSize);
            sh.set(id, s);
        } return s; },
        uniqueWordCount: (p) => uniq(p).length, titleOwners: titles[locale], descriptionOwners: descs[locale], orphans: input.orphans ?? new Set(),
    });
    const ctx = { ar: ctxFor('ar'), en: ctxFor('en') };
    const reports = [];
    for (const p of input.pages) {
        const results = checks_1.CHECKS.flatMap((f) => { try {
            return f(p, ctx[p.locale]);
        }
        catch (e) {
            return [{ id: 'empty-page', ok: false, severity: 'warn', detail: `check crashed: ${e.message.slice(0, 60)}` }];
        } });
        const failed = results.filter((r) => !r.ok);
        const blockingFailed = failed.filter((r) => cfg.blocking.includes(r.id)).map((r) => r.id);
        const score = Math.max(0, 100 - failed.reduce((s, r) => s + (cfg.blocking.includes(r.id) ? 20 : 5), 0));
        const other = pages.get((0, page_model_1.pageId)(p.pageKey, p.locale === 'ar' ? 'en' : 'ar'));
        const selfIncomplete = (0, parity_ar_en_1.completeProblems)(p).length > 0;
        const otherIncomplete = !other || (0, parity_ar_en_1.completeProblems)(other).length > 0;
        const parityFailed = failed.some((r) => r.id === 'parity-ar-en');
        const wouldNoindex = blockingFailed.some((id) => id !== 'parity-ar-en' && id !== 'hreflang') || (parityFailed && selfIncomplete) || (blockingFailed.includes('hreflang') && !parityFailed);
        reports.push({
            pageKey: p.pageKey, templateKind: p.templateKind, locale: p.locale, score, failedChecks: failed.map((r) => r.id), blockingFailed,
            details: Object.fromEntries(failed.filter((r) => r.detail).map((r) => [r.id, r.detail])), contentHash: (0, exports.contentHashOf)(p), wouldNoindex,
            omitAlternates: parityFailed && otherIncomplete ? [p.locale === 'ar' ? 'en' : 'ar'] : [],
        });
    }
    return { reports, context: ctx.ar };
}
function summarise(reports) {
    const by = new Map();
    for (const r of reports) {
        const s = by.get(r.templateKind) ?? { template: r.templateKind, pages: 0, failed: 0, avgScore: 0, checks: {} };
        s.pages++;
        s.avgScore += r.score;
        if (r.failedChecks.length)
            s.failed++;
        for (const c of r.failedChecks)
            s.checks[c] = (s.checks[c] ?? 0) + 1;
        by.set(r.templateKind, s);
    }
    return [...by.values()].map((s) => ({ ...s, avgScore: Math.round(s.avgScore / s.pages) })).sort((a, b) => (a.template < b.template ? -1 : 1));
}
//# sourceMappingURL=quality-gate.js.map