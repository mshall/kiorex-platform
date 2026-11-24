"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEO_EXTENSION_DEFAULTS = exports.TEMPLATE_PLACEHOLDERS = exports.TEMPLATE_LOCALES = exports.TEMPLATE_KEYS = void 0;
exports.validateTemplates = validateTemplates;
exports.mergeSeoExtensions = mergeSeoExtensions;
exports.validateSeoExtensions = validateSeoExtensions;
exports.TEMPLATE_KEYS = ['home', 'hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine', 'doctor', 'nurse', 'clinic', 'pharmacy', 'lab'];
exports.TEMPLATE_LOCALES = ['ar', 'en'];
exports.TEMPLATE_PLACEHOLDERS = ['name', 'specialty', 'city', 'district', 'country', 'clinic', 'count', 'fees', 'rating', 'where', 'care', 'brand'];
const SEO_EXTENSION_DEFAULTS = () => ({ templates: {}, paginatedIndexable: false, reviewMarkupMinCount: 5, sameDayWindowHours: 24, minAvailableProviders: 2, maxParentSimilarityPercent: 100 });
exports.SEO_EXTENSION_DEFAULTS = SEO_EXTENSION_DEFAULTS;
const PH = /\{([a-zA-Z]+)\}/g;
const MAX = { title: 120, description: 320 };
function validateTemplates(input) {
    const errors = [];
    const cleaned = {};
    if (input === undefined || input === null)
        return { valid: true, errors, cleaned };
    if (typeof input !== 'object' || Array.isArray(input))
        return { valid: false, errors: ['templates must be an object'], cleaned };
    for (const [loc, byKey] of Object.entries(input)) {
        if (!exports.TEMPLATE_LOCALES.includes(loc)) {
            errors.push(`unknown locale ${loc}`);
            continue;
        }
        if (!byKey || typeof byKey !== 'object' || Array.isArray(byKey)) {
            errors.push(`templates.${loc} must be an object`);
            continue;
        }
        for (const [key, t] of Object.entries(byKey)) {
            if (!exports.TEMPLATE_KEYS.includes(key)) {
                errors.push(`unknown page type ${loc}.${key}`);
                continue;
            }
            if (!t || typeof t !== 'object' || Array.isArray(t)) {
                errors.push(`templates.${loc}.${key} must be an object`);
                continue;
            }
            const out = {};
            let ok = true;
            for (const f of ['title', 'description']) {
                const v = t[f];
                if (v === undefined)
                    continue;
                if (typeof v !== 'string' || !v.trim()) {
                    errors.push(`${loc}.${key}.${f} must be a non-empty string`);
                    ok = false;
                    continue;
                }
                if (v.length > MAX[f]) {
                    errors.push(`${loc}.${key}.${f} is longer than ${MAX[f]} characters`);
                    ok = false;
                    continue;
                }
                if (/[<>]/.test(v)) {
                    errors.push(`${loc}.${key}.${f} must not contain markup`);
                    ok = false;
                    continue;
                }
                const bad = [...v.matchAll(PH)].map((m) => m[1]).filter((p) => !exports.TEMPLATE_PLACEHOLDERS.includes(p));
                if (bad.length) {
                    errors.push(`${loc}.${key}.${f} uses unknown placeholders: ${[...new Set(bad)].join(', ')}`);
                    ok = false;
                    continue;
                }
                if (/\{|\}/.test(v.replace(PH, ''))) {
                    errors.push(`${loc}.${key}.${f} has an unbalanced brace`);
                    ok = false;
                    continue;
                }
                out[f] = v.trim();
            }
            if (ok && (out.title || out.description)) {
                (cleaned[loc] ??= {})[key] = out;
            }
        }
    }
    return { valid: errors.length === 0, errors, cleaned };
}
const int = (v, min, max) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
function mergeSeoExtensions(base, payload) {
    if (!payload || typeof payload !== 'object')
        return base;
    const p = payload;
    const out = { ...base, templates: { ...base.templates } };
    if (p.templates !== undefined) {
        const v = validateTemplates(p.templates);
        for (const loc of Object.keys(v.cleaned))
            out.templates[loc] = { ...(out.templates[loc] ?? {}), ...v.cleaned[loc] };
    }
    if (typeof p.paginatedIndexable === 'boolean')
        out.paginatedIndexable = p.paginatedIndexable;
    out.reviewMarkupMinCount = int(p.reviewMarkupMinCount, 1, 1000) ?? out.reviewMarkupMinCount;
    out.sameDayWindowHours = int(p.sameDayWindowHours, 1, 72) ?? out.sameDayWindowHours;
    out.minAvailableProviders = int(p.minAvailableProviders, 1, 50) ?? out.minAvailableProviders;
    out.maxParentSimilarityPercent = int(p.maxParentSimilarityPercent, 50, 100) ?? out.maxParentSimilarityPercent;
    return out;
}
function validateSeoExtensions(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return { valid: false, errors: ['payload must be an object'] };
    const p = payload;
    const errors = [];
    if (p.templates !== undefined)
        errors.push(...validateTemplates(p.templates).errors);
    if (p.paginatedIndexable !== undefined && typeof p.paginatedIndexable !== 'boolean')
        errors.push('paginatedIndexable must be a boolean');
    for (const [k, min, max] of [['reviewMarkupMinCount', 1, 1000], ['sameDayWindowHours', 1, 72], ['minAvailableProviders', 1, 50], ['maxParentSimilarityPercent', 50, 100]]) {
        if (p[k] !== undefined && int(p[k], min, max) === undefined)
            errors.push(`${k} must be an integer from ${min} to ${max}`);
    }
    return { valid: errors.length === 0, errors };
}
//# sourceMappingURL=seo-extensions.js.map