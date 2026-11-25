"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashSeed = void 0;
exports.mulberry32 = mulberry32;
exports.percentile = percentile;
exports.subsample = subsample;
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function percentile(sorted, q) {
    if (!sorted.length)
        return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[i];
}
function subsample(items, n, rnd) {
    if (items.length <= n)
        return [...items];
    const a = [...items];
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rnd() * (a.length - i));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
}
const hashSeed = (seed, text) => { let h = seed >>> 0; for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0; return h; };
exports.hashSeed = hashSeed;
//# sourceMappingURL=bootstrap.js.map