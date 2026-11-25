"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathOfKey = exports.isEntityType = void 0;
exports.pageKeyOf = pageKeyOf;
exports.restOfKey = restOfKey;
const ENTITY = ['doctor', 'nurse', 'clinic', 'pharmacy', 'lab'];
const LISTING_SEG = {
    hub: (p) => `doctors/${p[0]}`, city: (p) => `doctors/${p[0]}/${p[1]}`, district: (p) => `doctors/${p[0]}/${p[1]}/${p[2]}`, 'care-district': (p) => `${p[0]}/${p[1]}/${p[2]}`,
    'city-hub': (p) => `locations/${p[0]}`, 'district-hub': (p) => `locations/${p[0]}/${p[1]}`, 'same-day': (p) => `same-day/${p[0]}`, telemedicine: (p) => `telemedicine/${p[0]}`,
};
const ORDER = {
    hub: ['specialty'], city: ['specialty', 'city'], district: ['specialty', 'city', 'district'], 'care-district': ['care', 'city', 'district'], 'city-hub': ['city'], 'district-hub': ['city', 'district'], 'same-day': ['specialty'], telemedicine: ['specialty'],
};
const isEntityType = (t) => ENTITY.includes(t);
exports.isEntityType = isEntityType;
function pageKeyOf(type, params) {
    if (type === 'home')
        return 'home:';
    if (ENTITY.includes(type))
        return `${type}:${params.slug ?? ''}`;
    const order = ORDER[type];
    if (!order)
        return `${type}:`;
    return `${type}:${order.map((k) => params[k] ?? '').join('/')}`;
}
function restOfKey(key) {
    const i = key.indexOf(':');
    const type = key.slice(0, i);
    const rest = key.slice(i + 1);
    if (type === 'home')
        return '';
    if (ENTITY.includes(type))
        return `${type}/${rest}`;
    return LISTING_SEG[type]?.(rest.split('/')) ?? '';
}
const pathOfKey = (locale, cc, key) => { const r = restOfKey(key); return `/${locale}/${cc.toLowerCase()}${r ? `/${r}` : ''}`; };
exports.pathOfKey = pathOfKey;
//# sourceMappingURL=page-key.js.map