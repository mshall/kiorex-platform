"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageCache = void 0;
class PageCache {
    maxEntries;
    ttlMs;
    now;
    map = new Map();
    hits = 0;
    misses = 0;
    constructor(maxEntries, ttlMs, now = Date.now) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.now = now;
    }
    get(key) {
        const e = this.map.get(key);
        if (!e) {
            this.misses++;
            return undefined;
        }
        if (this.now() - e.at > this.ttlMs) {
            this.map.delete(key);
            this.misses++;
            return undefined;
        }
        this.map.delete(key);
        this.map.set(key, e);
        this.hits++;
        return e.value;
    }
    set(key, value) {
        this.map.delete(key);
        this.map.set(key, { at: this.now(), value });
        while (this.map.size > this.maxEntries)
            this.map.delete(this.map.keys().next().value);
    }
    purgeTags(tags) {
        const want = new Set(tags);
        const gone = [];
        for (const [k, e] of this.map)
            if (e.value.tags.some((t) => want.has(t))) {
                this.map.delete(k);
                gone.push(k);
            }
        return gone;
    }
    clear() { const n = this.map.size; this.map.clear(); return n; }
    get size() { return this.map.size; }
}
exports.PageCache = PageCache;
//# sourceMappingURL=page-cache.js.map