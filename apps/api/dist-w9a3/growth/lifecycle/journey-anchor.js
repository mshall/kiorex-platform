"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.anchorPrefix = void 0;
exports.encodeAnchor = encodeAnchor;
exports.decodeAnchor = decodeAnchor;
const ID = /^[A-Za-z0-9_:.-]{1,80}$/;
function encodeAnchor(key, a) {
    if (!ID.test(a.id))
        throw new Error('invalid anchor id');
    const rest = Buffer.from(JSON.stringify({ at: a.at, p: a.params })).toString('base64url');
    return `${key}#${a.id}.${rest}`;
}
function decodeAnchor(journeyKey) {
    const i = journeyKey.indexOf('#');
    if (i < 0)
        return { key: journeyKey, anchor: null };
    const key = journeyKey.slice(0, i);
    const tail = journeyKey.slice(i + 1);
    const dot = tail.lastIndexOf('.');
    try {
        const id = tail.slice(0, dot);
        const r = JSON.parse(Buffer.from(tail.slice(dot + 1), 'base64url').toString('utf8'));
        return { key, anchor: { id, at: Number(r.at), params: r.p ?? {} } };
    }
    catch {
        return { key, anchor: null };
    }
}
const anchorPrefix = (key, id) => `${key}#${id}.`;
exports.anchorPrefix = anchorPrefix;
//# sourceMappingURL=journey-anchor.js.map