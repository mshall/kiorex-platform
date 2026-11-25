"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyOf = exports.splitKey = exports.pageId = void 0;
exports.parentKey = parentKey;
exports.siblingKeys = siblingKeys;
const pageId = (pageKey, locale) => `${pageKey}|${locale}`;
exports.pageId = pageId;
const splitKey = (pageKey) => { const i = pageKey.indexOf(':'); return { type: pageKey.slice(0, i), rest: pageKey.slice(i + 1) }; };
exports.splitKey = splitKey;
const keyOf = (type, rest) => `${type}:${rest}`;
exports.keyOf = keyOf;
function parentKey(pageKey) {
    const { type, rest } = (0, exports.splitKey)(pageKey);
    const parts = rest.split('/');
    switch (type) {
        case 'district': return (0, exports.keyOf)('city', parts.slice(0, 2).join('/'));
        case 'city': return (0, exports.keyOf)('hub', parts[0]);
        case 'district-hub': return (0, exports.keyOf)('city-hub', parts[0]);
        case 'same-day':
        case 'telemedicine': return (0, exports.keyOf)('hub', parts[0]);
        default: return null;
    }
}
function siblingKeys(pageKey, all) {
    const { type } = (0, exports.splitKey)(pageKey);
    const parent = parentKey(pageKey);
    return [...all].filter((k) => k !== pageKey && (0, exports.splitKey)(k).type === type && parentKey(k) === parent);
}
//# sourceMappingURL=page-model.js.map