"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOIN_KEYS = void 0;
exports.assertJoinKey = assertJoinKey;
exports.buildIdentityResolver = buildIdentityResolver;
exports.JOIN_KEYS = ['sub', 'visitorKey'];
function assertJoinKey(k) {
    if (!exports.JOIN_KEYS.includes(k))
        throw new RangeError(`join key '${k}' is not allowed: paths join on sub or visitorKey only`);
}
function buildIdentityResolver(touches) {
    const linked = new Map();
    for (const t of touches)
        if (t.sub && t.visitorKey) {
            let s = linked.get(t.visitorKey);
            if (!s)
                linked.set(t.visitorKey, (s = new Set()));
            s.add(t.sub);
        }
    return (t) => {
        if (t.sub)
            return `s:${t.sub}`;
        if (t.visitorKey) {
            const s = linked.get(t.visitorKey);
            return s && s.size === 1 ? `s:${[...s][0]}` : `v:${t.visitorKey}`;
        }
        return null;
    };
}
//# sourceMappingURL=identity-link.js.map