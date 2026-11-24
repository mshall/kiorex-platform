"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_REF_PATTERN = exports.DAILY_VERSION_BUDGET = exports.MAX_WINDOW_STEP = exports.ATTRIBUTION_WINDOW_KEYS = void 0;
exports.evaluateGuardrails = evaluateGuardrails;
exports.findSecretViolations = findSecretViolations;
const growth_env_1 = require("./growth-env");
exports.ATTRIBUTION_WINDOW_KEYS = ['providerTouchWindowDays', 'patientReferralWindowDays', 'campaignClickWindowDays'];
exports.MAX_WINDOW_STEP = 2;
const DAILY_VERSION_BUDGET = () => { const n = Number(process.env.GROWTH_CONFIG_DAILY_VERSION_BUDGET); return Number.isInteger(n) && n >= 1 ? n : 10; };
exports.DAILY_VERSION_BUDGET = DAILY_VERSION_BUDGET;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const toMin = (hhmm) => { const m = typeof hhmm === 'string' ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null; return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function evaluateGuardrails(i) {
    const errors = [];
    const warnings = [];
    const p = i.payload;
    const cur = i.current ?? null;
    switch (i.kind) {
        case 'ATTRIBUTION_POLICY': {
            for (const k of exports.ATTRIBUTION_WINDOW_KEYS) {
                const next = num(p[k]);
                const prev = cur ? num(cur[k]) : null;
                if (next === null || prev === null || prev === 0)
                    continue;
                if (next > prev * exports.MAX_WINDOW_STEP)
                    errors.push(`/${k}: ${prev} to ${next} days is more than x${exports.MAX_WINDOW_STEP} in one version; change it in steps`);
                else if (next * exports.MAX_WINDOW_STEP < prev)
                    errors.push(`/${k}: ${prev} to ${next} days is more than /${exports.MAX_WINDOW_STEP} in one version; change it in steps`);
            }
            if (cur && cur.precedence !== p.precedence)
                warnings.push(`/precedence changes from ${String(cur.precedence)} to ${String(p.precedence)}: every new booking is decided by the new rule from the effective date`);
            if ((num(p.campaignViewWindowHours) ?? 0) > 0)
                warnings.push('/campaignViewWindowHours > 0 turns on view-through credit, which privacy review has not approved (NEEDS_HUMAN)');
            if (p.allowOfflineEvidence === true)
                warnings.push('/allowOfflineEvidence lets staff-entered offline evidence make a booking provider-led; it needs a dispute process (NEEDS_HUMAN)');
            break;
        }
        case 'CONSENT_DEFAULTS': {
            const d = num(p.maxMarketingPerDay);
            const w = num(p.maxMarketingPerWeek);
            if (d !== null && w !== null && d > w)
                warnings.push('/maxMarketingPerDay is above /maxMarketingPerWeek, so the weekly cap is the one that binds');
            const s = toMin(p.quietHoursStart);
            const e = toMin(p.quietHoursEnd);
            if (s !== null && e !== null && s === e)
                errors.push('/quietHoursStart and /quietHoursEnd cannot be equal (that would be no quiet hours, or all day)');
            const prop = num(p.withdrawalPropagationSeconds);
            if (prop !== null && prop > 300)
                errors.push('/withdrawalPropagationSeconds above 300 is not acceptable for consent withdrawal');
            break;
        }
        case 'MARKET_GROWTH': {
            if (p.marketingLicenceConfirmed === true && !(i.ticket ?? '').trim())
                errors.push('/marketingLicenceConfirmed needs a ticket that references the counsel confirmation');
            if (p.marketingLicenceConfirmed === true)
                warnings.push('/marketingLicenceConfirmed does not unlock marketing: growth.marketing_messaging stays launch-locked until the gate evidence is recorded');
            if (i.scope === 'MARKET' && typeof p.market === 'string' && p.market !== i.scopeId)
                errors.push('/market must equal the scope id of a MARKET-scoped version');
            break;
        }
        case 'WIDGET_POLICY': {
            if (p.allowLocalhostOrigins === true && (0, growth_env_1.isProductionSite)())
                errors.push('/allowLocalhostOrigins must be false in production');
            if ((num(p.sessionTokenTtlSeconds) ?? 0) > 1800)
                warnings.push('/sessionTokenTtlSeconds above 30 minutes widens the window for a leaked widget token');
            break;
        }
        case 'SEO': {
            const min = num(p.minLiveProviders);
            if (min !== null && min < 2)
                errors.push('/minLiveProviders below 2 would index single-provider pages (thin and doorway risk)');
            const sim = num(p.maxSiblingSimilarityPercent);
            if (sim !== null && sim > 90)
                errors.push('/maxSiblingSimilarityPercent above 90 defeats the sibling-overlap guard');
            if (cur && min !== null && num(cur.minLiveProviders) !== null && min < num(cur.minLiveProviders))
                warnings.push('/minLiveProviders is lowered: more generated pages become indexable');
            break;
        }
        default: break;
    }
    return { errors, warnings };
}
exports.SECRET_REF_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,127}$/;
const SECRET_SHAPES = [/^sk[-_](live|test)[-_]/i, /^AKIA[0-9A-Z]{12,}$/, /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /^(?=.*[A-Z])(?=.*[0-9])[A-Za-z0-9+/=_-]{32,}$/, /^(xox[abp]-|ghp_|github_pat_)/i];
function findSecretViolations(value, path = '') {
    const out = [];
    if (typeof value === 'string') {
        if (SECRET_SHAPES.some((r) => r.test(value)) && !/^https?:\/\//.test(value))
            out.push(`${path || '/'}: looks like a raw secret; store only a secretRef name`);
        return out;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => out.push(...findSecretViolations(v, `${path}/${i}`)));
        return out;
    }
    if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            const p = `${path}/${k}`;
            if (/Ref$/.test(k) && typeof v === 'string' && !exports.SECRET_REF_PATTERN.test(v))
                out.push(`${p}: a secretRef is a lowercase name (a-z, 0-9, / _ . -), not a value`);
            else
                out.push(...findSecretViolations(v, p));
        }
    }
    return out;
}
//# sourceMappingURL=config-guardrails.js.map