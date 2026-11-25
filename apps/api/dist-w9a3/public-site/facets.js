"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.facetKey = void 0;
exports.countUniqueBlocks = countUniqueBlocks;
exports.buildFacets = buildFacets;
const url_policy_1 = require("./url-policy");
const thin_page_guard_1 = require("./thin-page-guard");
const geo_1 = require("./geo");
const maxDate = (ps) => ps.reduce((m, p) => (!m || p.lastModified > m ? p.lastModified : m), null);
function countUniqueBlocks(ps, hasRelated) {
    let n = 1;
    if (ps.some((p) => p.minFeeMinor != null))
        n++;
    if (ps.some((p) => p.languages.length))
        n++;
    if (ps.some((p) => p.nextSlotAt && p.nextSlotAt > new Date()))
        n++;
    if (ps.some((p) => p.ratingCount > 0))
        n++;
    if (hasRelated)
        n++;
    return n;
}
const titleCase = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
function buildFacets(all, params, enabledCareTypes, includeDistricts = true, opts = {}) {
    const now = opts.now ?? new Date();
    const sameDayUntil = new Date(now.getTime() + (opts.sameDayWindowHours ?? 24) * 3_600_000);
    const visible = all.filter((p) => p.status === 'LIVE' && p.listed && enabledCareTypes.has(p.careType));
    const groups = new Map();
    const add = (key, base, p) => {
        const g = groups.get(key) ?? { ...base, providers: [] };
        g.providers.push(p);
        groups.set(key, g);
    };
    for (const p of visible) {
        const citySlug = (0, geo_1.slugifyPlace)(p.governorate);
        const areaSlug = (0, geo_1.slugifyPlace)(p.area);
        if (citySlug) {
            add(`city-hub:${citySlug}`, { type: 'city-hub', params: { city: citySlug }, city: (0, geo_1.placeLabel)('city', p.governorate), district: null, specialtyCode: null, careType: null, siblingKey: 'city-hub' }, p);
            if (includeDistricts && areaSlug)
                add(`district-hub:${citySlug}/${areaSlug}`, { type: 'district-hub', params: { city: citySlug, district: areaSlug }, city: (0, geo_1.placeLabel)('city', p.governorate), district: (0, geo_1.placeLabel)('district', p.area), specialtyCode: null, careType: null, siblingKey: `district-hub:${citySlug}` }, p);
        }
        if (p.careType === 'DOCTORS' && p.specialty) {
            const sp = (0, geo_1.specialtySegment)(p.specialty);
            if (p.nextSlotAt && p.nextSlotAt > now && p.nextSlotAt <= sameDayUntil)
                add(`same-day:${sp}`, { type: 'same-day', params: { specialty: sp }, city: null, district: null, specialtyCode: p.specialty, careType: null, siblingKey: 'same-day' }, p);
            if (p.video)
                add(`telemedicine:${sp}`, { type: 'telemedicine', params: { specialty: sp }, city: null, district: null, specialtyCode: p.specialty, careType: null, siblingKey: 'telemedicine' }, p);
            add(`hub:${sp}`, { type: 'hub', params: { specialty: sp }, city: null, district: null, specialtyCode: p.specialty, careType: null, siblingKey: 'hub' }, p);
            if (citySlug) {
                add(`city:${sp}/${citySlug}`, { type: 'city', params: { specialty: sp, city: citySlug }, city: (0, geo_1.placeLabel)('city', p.governorate), district: null, specialtyCode: p.specialty, careType: null, siblingKey: `city:${sp}` }, p);
                if (includeDistricts && areaSlug) {
                    add(`district:${sp}/${citySlug}/${areaSlug}`, { type: 'district', params: { specialty: sp, city: citySlug, district: areaSlug }, city: (0, geo_1.placeLabel)('city', p.governorate), district: (0, geo_1.placeLabel)('district', p.area), specialtyCode: p.specialty, careType: null, siblingKey: `district:${sp}/${citySlug}` }, p);
                }
            }
        }
        else if (includeDistricts && citySlug) {
            const care = (Object.entries(url_policy_1.CARE_SEGMENTS).find(([, v]) => v === p.careType)?.[0]);
            if (!care)
                continue;
            const districts = new Set([...(areaSlug ? [areaSlug] : []), ...p.coverageDistricts]);
            for (const d of districts) {
                add(`care:${care}/${citySlug}/${d}`, { type: 'care-district', params: { care, city: citySlug, district: d }, city: (0, geo_1.placeLabel)('city', p.governorate), district: (0, geo_1.placeLabel)('district', d === areaSlug && p.area ? p.area : titleCase(d)), specialtyCode: null, careType: p.careType, siblingKey: `care:${care}/${citySlug}` }, p);
            }
        }
    }
    const bySibling = new Map();
    for (const [k, g] of groups)
        bySibling.set(g.siblingKey, [...(bySibling.get(g.siblingKey) ?? []), k]);
    const byKey = new Map();
    const related = (k) => {
        const g = groups.get(k);
        return g.type === 'hub' ? [...groups.values()].some((x) => x.type === 'city' && x.params.specialty === g.params.specialty) : (bySibling.get(g.siblingKey)?.length ?? 0) > 1;
    };
    const parentIds = (k, g) => {
        if (g.type === 'city-hub')
            return visible.map((p) => p.id);
        if (g.type === 'district-hub')
            return (groups.get(`city-hub:${g.params.city}`)?.providers ?? []).map((p) => p.id);
        if (g.type === 'same-day' || g.type === 'telemedicine')
            return (groups.get(`hub:${g.params.specialty}`)?.providers ?? []).map((p) => p.id);
        void k;
        return null;
    };
    for (const [k, g] of groups) {
        const ids = g.providers.map((p) => p.id);
        const parent = parentIds(k, g);
        const parentOverlap = parent ? (0, thin_page_guard_1.overlapPercent)(parent, ids) : null;
        const sibs = (bySibling.get(g.siblingKey) ?? []).filter((x) => x !== k);
        const overlap = g.type === 'hub' || !sibs.length ? null : Math.max(...sibs.map((s) => (0, thin_page_guard_1.overlapPercent)(ids, groups.get(s).providers.map((p) => p.id))));
        const blocks = countUniqueBlocks(g.providers, related(k));
        const guard = (0, thin_page_guard_1.evaluateGuard)({ type: g.type, liveProviders: g.providers.length, uniqueBlocks: blocks, siblingOverlapPercent: overlap, parentOverlapPercent: parentOverlap }, params);
        byKey.set(k, { key: k, type: g.type, params: g.params, providers: g.providers, city: g.city, district: g.district, specialtyCode: g.specialtyCode, careType: g.careType, uniqueBlocks: blocks, overlapPercent: overlap, parentOverlapPercent: parentOverlap, guard, lastModified: maxDate(g.providers) });
    }
    return { byKey, all: [...byKey.values()], visible };
}
const facetKey = (type, p) => {
    switch (type) {
        case 'hub': return `hub:${p.specialty}`;
        case 'city': return `city:${p.specialty}/${p.city}`;
        case 'district': return `district:${p.specialty}/${p.city}/${p.district}`;
        case 'city-hub': return `city-hub:${p.city}`;
        case 'district-hub': return `district-hub:${p.city}/${p.district}`;
        case 'same-day': return `same-day:${p.specialty}`;
        case 'telemedicine': return `telemedicine:${p.specialty}`;
        default: return `care:${p.care}/${p.city}/${p.district}`;
    }
};
exports.facetKey = facetKey;
//# sourceMappingURL=facets.js.map