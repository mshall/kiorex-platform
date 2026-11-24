"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathHashOf = exports.capPath = exports.MAX_PATH_TOUCHES = void 0;
exports.buildPaths = buildPaths;
const node_crypto_1 = require("node:crypto");
const identity_link_1 = require("./identity-link");
const windows_1 = require("./windows");
exports.MAX_PATH_TOUCHES = 50;
const capPath = (p, max = exports.MAX_PATH_TOUCHES) => (p.length <= max ? [...p] : [p[0], ...p.slice(p.length - (max - 1))]);
exports.capPath = capPath;
const pathHashOf = (kinds) => (0, node_crypto_1.createHash)('sha256').update(kinds.join('>')).digest('hex').slice(0, 16);
exports.pathHashOf = pathHashOf;
function buildPaths(touches, conversions, zone, windows = windows_1.DEFAULT_WINDOWS) {
    const resolve = (0, identity_link_1.buildIdentityResolver)(touches);
    const byPerson = new Map();
    for (const t of touches) {
        const k = resolve(t);
        if (!k)
            continue;
        let a = byPerson.get(k);
        if (!a)
            byPerson.set(k, (a = []));
        a.push(t);
    }
    for (const a of byPerson.values())
        a.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
    const convByPerson = new Map();
    const loose = [];
    for (const c of conversions) {
        if (!c.sub) {
            loose.push(c);
            continue;
        }
        const k = `s:${c.sub}`;
        let a = convByPerson.get(k);
        if (!a)
            convByPerson.set(k, (a = []));
        a.push(c);
    }
    const converting = [];
    for (const [person, convs] of convByPerson) {
        convs.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
        const ts = byPerson.get(person) ?? [];
        let floor = -Infinity;
        for (const c of convs) {
            const path = ts.filter((t) => t.at > floor && (0, windows_1.inWindow)(t, c.at, zone, windows)).map((t) => ({ at: t.at, kind: t.kind, ref: t.ref, campaignId: t.campaignId }));
            converting.push({ conversionId: c.id, at: c.at, revenueMinor: c.revenueMinor, touches: (0, exports.capPath)(path) });
            floor = c.at;
        }
    }
    for (const c of loose)
        converting.push({ conversionId: c.id, at: c.at, revenueMinor: c.revenueMinor, touches: [] });
    converting.sort((a, b) => a.at - b.at || (a.conversionId < b.conversionId ? -1 : 1));
    const nonConverting = [];
    const horizon = (0, windows_1.maxWindowDays)(windows) * 86_400_000;
    for (const [person, ts] of byPerson) {
        if (convByPerson.has(person)) {
            const last = convByPerson.get(person).at(-1).at;
            const rest = ts.filter((t) => t.at > last);
            if (rest.length)
                nonConverting.push({ kinds: (0, exports.capPath)(rest).map((t) => t.kind) });
            continue;
        }
        const newest = ts[ts.length - 1].at;
        const recent = ts.filter((t) => newest - t.at <= horizon);
        if (recent.length)
            nonConverting.push({ kinds: (0, exports.capPath)(recent).map((t) => t.kind) });
    }
    return { converting, nonConverting };
}
//# sourceMappingURL=path-builder.js.map