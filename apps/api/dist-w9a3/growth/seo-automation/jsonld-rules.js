"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSONLD_FORBIDDEN_KEYS = exports.JSONLD_ALLOWED_TYPES = void 0;
exports.jsonLdIssues = jsonLdIssues;
exports.JSONLD_ALLOWED_TYPES = ['Organization', 'WebSite', 'BreadcrumbList', 'ListItem', 'CollectionPage', 'ItemList', 'Physician', 'Dentist', 'MedicalBusiness', 'MedicalClinic', 'Pharmacy', 'PostalAddress', 'AggregateRating', 'ImageObject'];
exports.JSONLD_FORBIDDEN_KEYS = ['telephone', 'email', 'faxNumber', 'streetAddress', 'postalCode', 'geo', 'latitude', 'longitude', 'hasMap', 'openingHours', 'openingHoursSpecification', 'review', 'priceRange', 'paymentAccepted', 'medicalAudience', 'healthPlanNetworkId', 'isAcceptingNewPatientsFrom', 'sameAs'];
function jsonLdIssues(block, host) {
    const out = [];
    const walk = (v, path) => {
        if (Array.isArray(v))
            return v.forEach((x, i) => walk(x, `${path}[${i}]`));
        if (!v || typeof v !== 'object')
            return;
        const o = v;
        for (const k of Object.keys(o)) {
            if (exports.JSONLD_FORBIDDEN_KEYS.includes(k))
                out.push(`${path}.${k} is forbidden`);
            walk(o[k], `${path}.${k}`);
        }
        const t = o['@type'];
        if (typeof t === 'string' && !exports.JSONLD_ALLOWED_TYPES.includes(t))
            out.push(`${path} type ${t} is not allowed`);
        if (t === 'AggregateRating' && !(Number(o.ratingValue) >= 1 && Number(o.ratingValue) <= 5 && Number(o.reviewCount) > 0))
            out.push(`${path} AggregateRating is not valid`);
        for (const k of ['url', 'item'])
            if (typeof o[k] === 'string' && /^https?:\/\//.test(o[k]) && !o[k].startsWith(host))
                out.push(`${path}.${k} points outside ${host}`);
    };
    const r = block;
    if (!r || r['@context'] !== 'https://schema.org')
        out.push('@context must be https://schema.org');
    if (!r || typeof r['@type'] !== 'string')
        out.push('@type is required');
    walk(block, '$');
    if (r?.['@type'] === 'BreadcrumbList' && !(Array.isArray(r.itemListElement) && r.itemListElement.length >= 2))
        out.push('BreadcrumbList needs at least two items');
    return out;
}
//# sourceMappingURL=jsonld-rules.js.map