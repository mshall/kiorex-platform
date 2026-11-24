"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderError = void 0;
exports.mapStatus = mapStatus;
exports.providerRequest = providerRequest;
class ProviderError extends Error {
    code;
    retryable;
    status;
    attempts;
    constructor(code, retryable, status, attempts = 1) {
        super(`PROVIDER_${code}${status ? `_${status}` : ''}`);
        this.code = code;
        this.retryable = retryable;
        this.status = status;
        this.attempts = attempts;
        this.name = 'ProviderError';
    }
}
exports.ProviderError = ProviderError;
function mapStatus(status) {
    if (status === 429)
        return { code: 'RATE_LIMITED', retryable: true };
    if (status === 401 || status === 403)
        return { code: 'UNAUTHORIZED', retryable: false };
    if (status === 408)
        return { code: 'TIMEOUT', retryable: true };
    if (status >= 500)
        return { code: 'PROVIDER_UNAVAILABLE', retryable: true };
    if (status === 422 || status === 400)
        return { code: 'INVALID_REQUEST', retryable: false };
    return { code: 'REJECTED', retryable: false };
}
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 5000;
async function providerRequest(env, req, deps = {}, authHeaders = {}) {
    const f = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const rnd = deps.random ?? Math.random;
    const url = req.absoluteUrl ?? `${env.apiUrl}${req.path.startsWith('/') ? '' : '/'}${req.path}`;
    const method = req.method ?? 'POST';
    const bodyStr = req.form ? new URLSearchParams(req.form).toString() : req.body === undefined ? undefined : JSON.stringify(req.body);
    const headers = { accept: 'application/json', ...(req.form ? { 'content-type': 'application/x-www-form-urlencoded' } : req.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders, ...req.headers };
    if (req.idempotencyKey)
        headers['idempotency-key'] = req.idempotencyKey;
    const max = env.maxRetries + 1;
    let last;
    for (let attempt = 1; attempt <= max; attempt++) {
        let retryAfterMs = 0;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), env.timeoutMs);
        try {
            const signed = req.sign ? req.sign({ method, url, body: bodyStr ?? '' }) : {};
            const res = await f(url, { method, headers: { ...headers, ...signed }, body: bodyStr, signal: ctl.signal });
            const text = await res.text();
            if (res.ok) {
                let json = {};
                if (text) {
                    try {
                        json = JSON.parse(text);
                    }
                    catch {
                        throw new ProviderError('BAD_RESPONSE', false, res.status, attempt);
                    }
                }
                return { status: res.status, json, headers: res.headers, attempts: attempt };
            }
            const m = mapStatus(res.status);
            const ra = Number(res.headers.get('retry-after'));
            if (Number.isFinite(ra) && ra > 0)
                retryAfterMs = Math.min(ra * 1000, MAX_DELAY_MS);
            last = new ProviderError(m.code, m.retryable, res.status, attempt);
        }
        catch (e) {
            if (e instanceof ProviderError) {
                last = e;
                if (!e.retryable)
                    throw e;
            }
            else
                last = new ProviderError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', true, undefined, attempt);
        }
        finally {
            clearTimeout(timer);
        }
        if (!last.retryable || attempt === max)
            break;
        const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
        await sleep(Math.max(retryAfterMs, backoff / 2 + rnd() * (backoff / 2)));
    }
    throw new ProviderError(last.code, last.retryable, last.status, last.attempts);
}
//# sourceMappingURL=http.js.map