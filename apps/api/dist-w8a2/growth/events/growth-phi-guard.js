"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROWTH_PROP_MAX = exports.GROWTH_EVENT_PROP_KEYS = void 0;
exports.guardEventProps = guardEventProps;
exports.parseEventsBody = parseEventsBody;
const contracts_1 = require("@kiorex/contracts");
const safety_public_1 = require("../../safety/safety-public");
const growth_errors_1 = require("../growth-errors");
exports.GROWTH_EVENT_PROP_KEYS = ['surface', 'platform', 'locale', 'step', 'variant', 'position', 'count', 'bucket', 'reason', 'sourceKind', 'market', 'appVersion', 'widgetId'];
const PHI_KEY = /specialt|provider|doctor|clinic|clinician|nurse|lab|pharm|diagnos|symptom|condition|drug|medic|prescri|treat|visit|reason_text|query|search|text|note|comment|name|phone|mobile|email|mail|address|district|city|national|sub\b|user|patient|booking|appointment|ip\b/i;
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
exports.GROWTH_PROP_MAX = 8;
function guardEventProps(props) {
    if (props === undefined || props === null)
        return {};
    if (typeof props !== 'object' || Array.isArray(props))
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'props must be an object');
    const entries = Object.entries(props);
    if (entries.length > exports.GROWTH_PROP_MAX)
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `props has at most ${exports.GROWTH_PROP_MAX} keys`);
    const out = {};
    for (const [k, v] of entries) {
        if (PHI_KEY.test(k))
            throw (0, growth_errors_1.growthError)('GROWTH_PHI_REJECTED', `props.${k.slice(0, 40)} names data that never enters the visitor stream`);
        if (!exports.GROWTH_EVENT_PROP_KEYS.includes(k))
            throw (0, growth_errors_1.growthError)('GROWTH_EVENT_NOT_ALLOWED', `props.${k.slice(0, 40)} is not an allowed key`, { allowed: exports.GROWTH_EVENT_PROP_KEYS });
        if (typeof v === 'number') {
            if (!Number.isFinite(v) || Math.abs(v) > 1e9)
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `props.${k} is out of range`);
            out[k] = v;
            continue;
        }
        if (typeof v === 'boolean') {
            out[k] = v;
            continue;
        }
        if (typeof v !== 'string' || !TOKEN.test(v))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `props.${k} must be a short token`);
        if ((0, safety_public_1.detectPhi)(v).length)
            throw (0, growth_errors_1.growthError)('GROWTH_PHI_REJECTED', `props.${k} looks like personal data`);
        out[k] = v;
    }
    return out;
}
function parseEventsBody(body, now = new Date()) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.events))
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'events must be an array');
    const list = body.events;
    if (list.length < 1 || list.length > 20)
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'events must hold 1 to 20 items');
    return list.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'every event must be an object');
        const e = raw;
        if (typeof e.name !== 'string')
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'event name is required');
        if (!contracts_1.GROWTH_CLIENT_EVENT_NAMES.includes(e.name))
            throw (0, growth_errors_1.growthError)('GROWTH_EVENT_NOT_ALLOWED', `${e.name.slice(0, 40)} cannot be reported by a client`, { allowed: contracts_1.GROWTH_CLIENT_EVENT_NAMES });
        const out = { name: e.name, props: {} };
        if (e.occurredAt !== undefined) {
            const t = typeof e.occurredAt === 'string' ? new Date(e.occurredAt) : null;
            if (!t || Number.isNaN(t.getTime()))
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'occurredAt must be an ISO date-time');
            out.occurredAt = t.getTime() > now.getTime() + 5 * 60_000 || t.getTime() < now.getTime() - 48 * 3600_000 ? now : t;
        }
        if (e.careType !== undefined) {
            if (!contracts_1.GROWTH_CARE_TYPES.includes(e.careType))
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'careType must be DOCTORS, PHYSIOTHERAPY or HOME_NURSING');
            out.careType = e.careType;
        }
        if (e.landingKind !== undefined) {
            if (!contracts_1.GROWTH_LANDING_KINDS.includes(e.landingKind))
                throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'landingKind is not a known landing kind');
            out.landingKind = e.landingKind;
        }
        for (const k of Object.keys(e))
            if (!['name', 'occurredAt', 'careType', 'landingKind', 'props'].includes(k)) {
                if (PHI_KEY.test(k))
                    throw (0, growth_errors_1.growthError)('GROWTH_PHI_REJECTED', `${k.slice(0, 40)} never enters the visitor stream`);
                throw (0, growth_errors_1.growthError)('GROWTH_EVENT_NOT_ALLOWED', `${k.slice(0, 40)} is not an allowed field`);
            }
        out.props = guardEventProps(e.props);
        return out;
    });
}
//# sourceMappingURL=growth-phi-guard.js.map