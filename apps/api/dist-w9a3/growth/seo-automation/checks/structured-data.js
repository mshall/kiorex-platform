"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requiredProps = requiredProps;
exports.structuredData = structuredData;
const jsonld_rules_1 = require("../jsonld-rules");
const REQUIRED = {
    Organization: ['name'], WebSite: ['name', 'url'], BreadcrumbList: ['itemListElement'], ListItem: ['position'], CollectionPage: ['name'], ItemList: ['itemListElement'],
    Physician: ['name'], Dentist: ['name'], MedicalBusiness: ['name'], MedicalClinic: ['name'], Pharmacy: ['name'], PostalAddress: [], AggregateRating: ['ratingValue', 'reviewCount'], ImageObject: ['url'],
};
function requiredProps(block, path = '$') {
    const out = [];
    const walk = (v, p) => {
        if (Array.isArray(v))
            return v.forEach((x, i) => walk(x, `${p}[${i}]`));
        if (!v || typeof v !== 'object')
            return;
        const o = v;
        const t = o['@type'];
        if (typeof t === 'string' && REQUIRED[t])
            for (const k of REQUIRED[t])
                if (o[k] === undefined || o[k] === '' || (Array.isArray(o[k]) && !o[k].length))
                    out.push(`${p} ${t} needs ${k}`);
        for (const [k, x] of Object.entries(o))
            walk(x, `${p}.${k}`);
    };
    walk(block, path);
    return out;
}
const hasType = (v, type) => (Array.isArray(v) ? v.some((x) => hasType(x, type)) : !!v && typeof v === 'object' && (v['@type'] === type || Object.values(v).some((x) => hasType(x, type))));
function structuredData(p, c) {
    const issues = [];
    if (!p.jsonLd.length && !['not-found'].includes(p.templateKind))
        issues.push('no JSON-LD block');
    for (const b of p.jsonLd) {
        issues.push(...(0, jsonld_rules_1.jsonLdIssues)(b, c.host), ...requiredProps(b));
    }
    const rating = hasType(p.jsonLd, 'AggregateRating');
    const review = [
        ...(rating && !c.reviewMarkupEnabled ? ['AggregateRating while review markup is switched off'] : []),
        ...(rating && p.visibleReviews < c.reviewMarkupMinCount ? [`AggregateRating with ${p.visibleReviews} visible reviews (${c.reviewMarkupMinCount} needed)`] : []),
    ];
    const out = [issues.length ? { id: 'structured-data', ok: false, severity: 'block', detail: issues.slice(0, 4).join('; ') } : { id: 'structured-data', ok: true, severity: 'block' }];
    out.push(review.length ? { id: 'review-markup', ok: false, severity: 'block', detail: review.join('; ') } : { id: 'review-markup', ok: true, severity: 'block' });
    return out;
}
//# sourceMappingURL=structured-data.js.map