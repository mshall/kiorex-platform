"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FUNNEL_STAGES = exports.PREFERRED_TIMES = exports.LEAD_STATUSES = exports.LEAD_KINDS = void 0;
exports.parseLeadBody = parseLeadBody;
exports.parseFunnelBody = parseFunnelBody;
const errors_1 = require("../common/errors");
exports.LEAD_KINDS = ['CLINIC', 'NURSE', 'PHARMACY', 'LAB'];
exports.LEAD_STATUSES = ['NEW', 'CONTACTED', 'STARTED', 'SUBMITTED', 'LIVE', 'CLOSED'];
exports.PREFERRED_TIMES = ['MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME'];
exports.FUNNEL_STAGES = ['INTERESTED', 'STARTED'];
const CTRL = /[\u0000-\u001f\u007f]/;
const ORGREF = /^[A-Za-z0-9_.:-]{1,80}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,22}$/;
const bad = (field) => (0, errors_1.badRequest)('INVALID_REQUEST', `Invalid ${field}`, { field });
const str = (v, field, max, min = 1, multiline = false) => {
    if (typeof v !== 'string')
        throw bad(field);
    const s = v.trim();
    if (s.length < min || s.length > max)
        throw bad(field);
    if ((multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : CTRL).test(s))
        throw bad(field);
    return s;
};
function obj(raw, allowed) {
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
        if (!allowed.includes(k))
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Unknown field', { field: k.slice(0, 40) });
    return b;
}
function head(b) {
    if (!exports.LEAD_KINDS.includes(b.kind))
        throw (0, errors_1.badRequest)('INVALID_KIND', 'kind must be CLINIC, NURSE, PHARMACY or LAB');
    const nonce = str(b.nonce, 'nonce', 64, 16);
    if (!NONCE.test(nonce))
        throw bad('nonce');
    const orgRef = str(b.orgRef, 'orgRef', 80);
    if (!ORGREF.test(orgRef))
        throw bad('orgRef');
    return { kind: b.kind, nonce, orgRef };
}
function parseLeadBody(raw) {
    const b = obj(raw, ['nonce', 'kind', 'orgRef', 'orgName', 'contactName', 'contactRole', 'phone', 'email', 'preferredTime', 'note', 'locale', 'market', 'consent']);
    const h = head(b);
    if (b.consent !== true)
        throw (0, errors_1.badRequest)('CONSENT_REQUIRED', 'Consent to be contacted is required');
    const out = { ...h, orgName: str(b.orgName, 'orgName', 160), contactName: str(b.contactName, 'contactName', 120), locale: b.locale === 'ar' ? 'ar' : 'en', market: 'EG', consent: true };
    if (b.locale !== undefined && b.locale !== 'ar' && b.locale !== 'en')
        throw bad('locale');
    if (b.market !== undefined) {
        out.market = str(b.market, 'market', 2, 2).toUpperCase();
        if (!/^[A-Z]{2}$/.test(out.market))
            throw bad('market');
    }
    if (b.contactRole != null && b.contactRole !== '')
        out.contactRole = str(b.contactRole, 'contactRole', 80);
    if (b.phone != null && b.phone !== '') {
        out.phone = str(b.phone, 'phone', 24);
        if (!PHONE.test(out.phone))
            throw bad('phone');
    }
    if (b.email != null && b.email !== '') {
        out.email = str(b.email, 'email', 160);
        if (!EMAIL.test(out.email))
            throw bad('email');
    }
    if (!out.phone && !out.email)
        throw (0, errors_1.badRequest)('CONTACT_REQUIRED', 'A phone number or an e-mail is required');
    if (b.preferredTime != null && b.preferredTime !== '') {
        if (!exports.PREFERRED_TIMES.includes(b.preferredTime))
            throw bad('preferredTime');
        out.preferredTime = b.preferredTime;
    }
    if (b.note != null && b.note !== '')
        out.note = str(b.note, 'note', 500, 1, true);
    return out;
}
function parseFunnelBody(raw) {
    const b = obj(raw, ['nonce', 'kind', 'orgRef', 'stage']);
    const h = head(b);
    if (!exports.FUNNEL_STAGES.includes(b.stage))
        throw bad('stage');
    return { ...h, stage: b.stage };
}
//# sourceMappingURL=lead-validation.js.map