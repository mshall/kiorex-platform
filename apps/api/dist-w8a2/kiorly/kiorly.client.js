"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KiorlyClient = exports.KiorlyTransientError = exports.KiorlyHttpError = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const outbound_http_1 = require("../common/outbound-http");
const hmac_1 = require("../common/hmac");
class KiorlyHttpError extends Error {
    status;
    code;
    body;
    constructor(status, code, body) {
        super(`Kiorly ${status}${code ? ` ${code}` : ''}`);
        this.status = status;
        this.code = code;
        this.body = body;
    }
}
exports.KiorlyHttpError = KiorlyHttpError;
class KiorlyTransientError extends Error {
    kind;
    status;
    constructor(message, kind, status) {
        super(message);
        this.kind = kind;
        this.status = status;
    }
}
exports.KiorlyTransientError = KiorlyTransientError;
const FAIL_THRESHOLD = 5;
const OPEN_MS = 30_000;
let KiorlyClient = class KiorlyClient {
    log = new common_1.Logger('kiorly');
    breakers = new Map();
    isCircuitOpen(clinicId) {
        const b = this.breakers.get(clinicId);
        return !!b && b.openUntil > Date.now();
    }
    resetCircuit(clinicId) {
        clinicId ? this.breakers.delete(clinicId) : this.breakers.clear();
    }
    circuitStates() {
        return [...this.breakers.entries()].map(([clinicId, b]) => ({ clinicId, fails: b.fails, open: b.openUntil > Date.now(), openUntil: b.openUntil > Date.now() ? new Date(b.openUntil) : null }));
    }
    record(clinicId, ok) {
        if (!clinicId)
            return;
        const b = this.breakers.get(clinicId) ?? { fails: 0, openUntil: 0 };
        if (ok)
            this.breakers.delete(clinicId);
        else {
            b.fails++;
            if (b.fails >= FAIL_THRESHOLD)
                b.openUntil = Date.now() + OPEN_MS;
            this.breakers.set(clinicId, b);
        }
    }
    async request(r) {
        if (r.clinicId && this.isCircuitOpen(r.clinicId) && r.method !== 'GET')
            throw new KiorlyTransientError('circuit open', 'CIRCUIT_OPEN');
        const c = (0, config_1.cfg)();
        const base = c.kiorlyBaseUrl.replace(/\/$/, '');
        const qs = r.query ? '?' + new URLSearchParams(Object.entries(r.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
        const url = `${base}${r.path}${qs}`;
        const body = r.body === undefined ? undefined : JSON.stringify(r.body);
        const signed = (0, hmac_1.signKiorlyRequest)({ clientKey: c.kiorlyClientKey, clientSecret: c.kiorlyClientSecret, method: r.method, path: new URL(url).pathname, body });
        const headers = { ...signed.headers, accept: 'application/json' };
        if (body !== undefined)
            headers['content-type'] = 'application/json';
        if (r.idempotencyKey)
            headers['idempotency-key'] = r.idempotencyKey;
        let res;
        try {
            res = await (0, outbound_http_1.outboundFetch)(url, { method: r.method, headers, body, signal: AbortSignal.timeout(c.kiorlyTimeoutMs) });
        }
        catch (e) {
            this.record(r.clinicId, false);
            const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
            throw new KiorlyTransientError(timeout ? 'timeout' : `network: ${e.message}`, timeout ? 'TIMEOUT' : 'NETWORK');
        }
        const text = await res.text();
        let data;
        try {
            data = text ? JSON.parse(text) : undefined;
        }
        catch {
            data = { raw: text.slice(0, 200) };
        }
        if (res.status >= 500 || res.status === 429) {
            this.record(r.clinicId, false);
            throw new KiorlyTransientError(`HTTP ${res.status}`, 'HTTP_5XX', res.status);
        }
        this.record(r.clinicId, true);
        if (res.status >= 400)
            throw new KiorlyHttpError(res.status, data?.code ?? data?.message?.code, data);
        return { status: res.status, data: data };
    }
    listProviders(q) {
        return this.request({ method: 'GET', path: '/providers', query: q });
    }
    slots(clinicId, q) {
        return this.request({ method: 'GET', path: `/clinics/${encodeURIComponent(clinicId)}/slots`, query: q, clinicId });
    }
    createHold(body) {
        return this.request({ method: 'POST', path: '/holds', body, clinicId: body.clinicId });
    }
    releaseHold(clinicId, holdId) {
        return this.request({ method: 'DELETE', path: `/holds/${encodeURIComponent(holdId)}`, clinicId });
    }
    createBooking(idempotencyKey, body) {
        return this.request({ method: 'POST', path: '/bookings', body, idempotencyKey, clinicId: body.clinicId });
    }
    getBooking(ref, clinicId) {
        return this.request({ method: 'GET', path: `/bookings/${encodeURIComponent(ref)}`, clinicId });
    }
    cancelBooking(ref, reason, clinicId) {
        return this.request({ method: 'POST', path: `/bookings/${encodeURIComponent(ref)}/cancel`, body: { reason }, clinicId });
    }
    createCarePlanRequest(body) {
        return this.request({ method: 'POST', path: '/care-plan-requests', body, clinicId: body.clinicId });
    }
    referralLink(code) {
        return this.request({ method: 'GET', path: `/referral-links/${encodeURIComponent(code)}` });
    }
    referralLinks(q) {
        return this.request({ method: 'GET', path: '/referral-links', query: q });
    }
    rescheduleBooking(ref, body, clinicId) {
        return this.request({ method: 'POST', path: `/bookings/${encodeURIComponent(ref)}/reschedule`, body, clinicId });
    }
    depositPaid(ref, body) {
        return this.request({ method: 'POST', path: `/bookings/${encodeURIComponent(ref)}/deposit-paid`, body });
    }
    depositLinkPaid(token, body) {
        return this.request({ method: 'POST', path: `/deposit-links/${encodeURIComponent(token)}/paid`, body });
    }
    recordPayout(body) {
        return this.request({ method: 'POST', path: '/payouts', body });
    }
    syncReviews(body) {
        return this.request({ method: 'POST', path: '/reviews/aggregate', body });
    }
    syncProfileViews(body) {
        return this.request({ method: 'POST', path: '/analytics/profile-views', body });
    }
    pushLabOrderStatus(orderId, body, clinicId) {
        return this.request({ method: 'POST', path: `/lab-orders/${encodeURIComponent(orderId)}/status`, body, clinicId });
    }
    upsertRecordShareConsents(kiorlyPatientId, consents, clinicId) {
        return this.request({ method: 'POST', path: `/patients/${encodeURIComponent(kiorlyPatientId)}/consents`, body: { consents }, clinicId });
    }
    importRecords(batchId, body) {
        return this.request({ method: 'POST', path: `/imports/${encodeURIComponent(batchId)}/records`, body, idempotencyKey: `imp-chunk:${batchId}:${body.entity}:${body.items[0]?.idempotencyKey ?? ''}` });
    }
    importRollback(batchId, body) {
        return this.request({ method: 'POST', path: `/imports/${encodeURIComponent(batchId)}/rollback`, body });
    }
};
exports.KiorlyClient = KiorlyClient;
exports.KiorlyClient = KiorlyClient = __decorate([
    (0, common_1.Injectable)()
], KiorlyClient);
//# sourceMappingURL=kiorly.client.js.map