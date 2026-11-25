"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.str = exports.obj = exports.arr = exports.num = exports.RealAdapter = exports.defaultHttp = void 0;
const types_1 = require("./types");
const outbound_http_1 = require("../../../common/outbound-http");
const defaultHttp = async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), init.timeoutMs);
    try {
        const r = await (0, outbound_http_1.outboundFetch)(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal });
        return { status: r.status, json: await r.json().catch(() => null) };
    }
    catch (e) {
        throw new types_1.UpstreamError(e.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_STATUS');
    }
    finally {
        clearTimeout(t);
    }
};
exports.defaultHttp = defaultHttp;
class RealAdapter {
    spec;
    cfg;
    mode = 'real';
    kind;
    constructor(spec, cfg) {
        this.spec = spec;
        this.cfg = cfg;
        this.kind = spec.kind;
    }
    async secret() {
        const ref = this.cfg.secretRef;
        if (!ref)
            throw new types_1.NeedsHumanError(this.kind, 'has no secretRef configured');
        if (!types_1.SECRET_REF.test(ref))
            throw new types_1.NeedsHumanError(this.kind, 'secretRef is not a valid reference name');
        const v = await this.cfg.resolveSecret(ref);
        if (!v)
            throw new types_1.NeedsHumanError(this.kind, 'secret does not resolve');
        return v;
    }
    async health() {
        try {
            await this.secret();
            return { ok: true, mode: 'real', detail: 'secret resolves; no upstream call was made' };
        }
        catch (e) {
            return { ok: false, mode: 'real', detail: e instanceof types_1.NeedsHumanError ? e.reason : 'unavailable' };
        }
    }
    async run(what, range) {
        if (!this.spec.pulls.includes(what))
            return [];
        const secret = await this.secret();
        const req = this.spec.build(range, secret, what, this.cfg.account ?? '');
        const res = await (this.cfg.http ?? exports.defaultHttp)(req.url, { method: req.method, headers: req.headers, body: req.body, timeoutMs: this.cfg.timeoutMs ?? 15_000 });
        if (res.status === 429)
            throw new types_1.UpstreamError('RATE_LIMITED', 429);
        if (res.status < 200 || res.status >= 300)
            throw new types_1.UpstreamError('UPSTREAM_STATUS', res.status);
        return this.spec.parse(res.json, what, range);
    }
    pullSpend(r) { return this.run('spend', r); }
    pullPerformance(r) { return this.run('performance', r); }
    pullCoreVitals(r) { return this.run('coreVitals', r); }
}
exports.RealAdapter = RealAdapter;
const num = (v) => { const n = typeof v === 'string' ? Number(v) : v; if (typeof n !== 'number' || !Number.isFinite(n))
    throw new types_1.UpstreamError('UPSTREAM_PARSE'); return n; };
exports.num = num;
const arr = (v) => { if (!Array.isArray(v))
    throw new types_1.UpstreamError('UPSTREAM_PARSE'); return v; };
exports.arr = arr;
const obj = (v) => { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new types_1.UpstreamError('UPSTREAM_PARSE'); return v; };
exports.obj = obj;
const str = (v) => { if (typeof v !== 'string')
    throw new types_1.UpstreamError('UPSTREAM_PARSE'); return v; };
exports.str = str;
//# sourceMappingURL=real-adapter.js.map