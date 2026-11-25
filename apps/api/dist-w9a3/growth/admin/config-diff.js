"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffPayload = diffPayload;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function diffPayload(before, after, path = '') {
    if (isObj(before) && isObj(after)) {
        const out = [];
        for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
            const p = `${path}/${k}`;
            if (!(k in before))
                out.push({ path: p, kind: 'added', after: after[k] });
            else if (!(k in after))
                out.push({ path: p, kind: 'removed', before: before[k] });
            else
                out.push(...diffPayload(before[k], after[k], p));
        }
        return out;
    }
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: path || '/', kind: 'changed', before, after }];
}
//# sourceMappingURL=config-diff.js.map