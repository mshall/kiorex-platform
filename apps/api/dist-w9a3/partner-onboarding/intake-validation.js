"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READINESS_MAX_BYTES = void 0;
exports.parseIntakeBody = parseIntakeBody;
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../common/errors");
const steps_1 = require("./steps");
const ALLOWED = new Set(['nonce', 'kind', 'orgRef', 'name', 'nameAr', 'market', 'contactEmail', 'locale', 'statusToken', 'baseUrl', 'clientKey', 'clientSecret', 'webhookSecret', 'readiness']);
const HOST_RE = /^https?:\/\/[^/\s?#]+$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/;
const ORGREF_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/;
exports.READINESS_MAX_BYTES = 8000;
const str = (v, field, max, min = 1) => {
    if (typeof v !== 'string' || v.length < min || v.length > max || CTRL_RE.test(v))
        throw (0, errors_1.badRequest)('INVALID_REQUEST', `Invalid ${field}`, { field });
    return v;
};
function parseIntakeBody(raw) {
    let b;
    try {
        b = JSON.parse(raw);
    }
    catch {
        throw (0, errors_1.badRequest)('INVALID_JSON', 'Body is not JSON');
    }
    if (!b || typeof b !== 'object' || Array.isArray(b))
        throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Body must be a JSON object');
    for (const k of Object.keys(b))
        if (!ALLOWED.has(k))
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Unknown field', { field: k.slice(0, 40) });
    if (!steps_1.CONN_KINDS.includes(b.kind))
        throw (0, errors_1.badRequest)('INVALID_KIND', 'kind must be CLINIC, NURSE, PHARMACY or LAB');
    const out = { kind: b.kind, nonce: str(b.nonce, 'nonce', 64, 16), orgRef: str(b.orgRef, 'orgRef', 80), name: str(b.name, 'name', 160) };
    if (!contracts_1.INTAKE_NONCE_PATTERN.test(out.nonce))
        throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid nonce', { field: 'nonce' });
    if (!ORGREF_RE.test(out.orgRef))
        throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid orgRef', { field: 'orgRef' });
    if (b.nameAr !== undefined)
        out.nameAr = str(b.nameAr, 'nameAr', 160);
    if (b.market !== undefined) {
        out.market = str(b.market, 'market', 2, 2).toUpperCase();
        if (!/^[A-Z]{2}$/.test(out.market))
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid market', { field: 'market' });
    }
    if (b.contactEmail !== undefined && b.contactEmail !== null) {
        out.contactEmail = str(b.contactEmail, 'contactEmail', 160);
        if (!EMAIL_RE.test(out.contactEmail))
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid contactEmail', { field: 'contactEmail' });
    }
    if (b.locale !== undefined) {
        if (b.locale !== 'ar' && b.locale !== 'en')
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid locale', { field: 'locale' });
        out.locale = b.locale;
    }
    if (b.statusToken !== undefined) {
        out.statusToken = str(b.statusToken, 'statusToken', 128, 32);
        if (!/^[A-Za-z0-9_-]+$/.test(out.statusToken))
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid statusToken', { field: 'statusToken' });
    }
    if (b.readiness !== undefined) {
        if (!b.readiness || typeof b.readiness !== 'object' || Array.isArray(b.readiness))
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Invalid readiness', { field: 'readiness' });
        if (JSON.stringify(b.readiness).length > exports.READINESS_MAX_BYTES)
            throw (0, errors_1.badRequest)('READINESS_TOO_LARGE', 'readiness snapshot is too large');
        out.readiness = b.readiness;
    }
    if ((0, steps_1.needsHandshakeCreds)(out.kind)) {
        const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.replace(/\/+$/, '') : '';
        if (!HOST_RE.test(baseUrl) || baseUrl.length > 200)
            throw (0, errors_1.badRequest)('INVALID_BASE_URL', 'baseUrl must be a host URL without a path');
        for (const [f, max] of [['clientKey', 120], ['clientSecret', 200], ['webhookSecret', 200]]) {
            if (typeof b[f] !== 'string' || !b[f] || b[f].length > max || CTRL_RE.test(b[f]))
                throw (0, errors_1.badRequest)('CREDENTIALS_REQUIRED', 'clientKey, clientSecret and webhookSecret are required');
        }
        out.baseUrl = baseUrl;
        out.clientKey = b.clientKey;
        out.clientSecret = b.clientSecret;
        out.webhookSecret = b.webhookSecret;
    }
    else if (b.baseUrl !== undefined || b.clientKey !== undefined || b.clientSecret !== undefined || b.webhookSecret !== undefined) {
        throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Credentials are only accepted for PHARMACY and LAB');
    }
    return out;
}
//# sourceMappingURL=intake-validation.js.map