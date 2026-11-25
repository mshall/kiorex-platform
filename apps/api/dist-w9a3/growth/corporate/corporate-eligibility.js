"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_MAIL_DOMAINS = void 0;
exports.evaluateEligibility = evaluateEligibility;
const corporate_code_1 = require("./corporate-code");
exports.FREE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com']);
function evaluateEligibility(i) {
    const { policy, account, code, facts, now } = i;
    if (account.status !== 'ACTIVE' || (account.startsAt && account.startsAt > now) || (account.endsAt && account.endsAt <= now))
        return { ok: false, reason: 'ACCOUNT_NOT_ACTIVE' };
    if (facts.alreadyMember)
        return { ok: false, reason: 'ALREADY_MEMBER' };
    if (code) {
        if (code.status !== 'ACTIVE')
            return { ok: false, reason: 'CODE_REVOKED' };
        if (code.expiresAt && code.expiresAt <= now)
            return { ok: false, reason: 'CODE_EXPIRED' };
        if (code.redeemedCount >= code.maxRedemptions)
            return { ok: false, reason: 'CODE_EXHAUSTED' };
        if (code.kind === 'LIST') {
            if (!policy.hrList)
                return { ok: false, reason: 'HR_LIST_OFF' };
            return facts.hrListMatch ? { ok: true, verifiedBy: 'HR_LIST' } : { ok: false, reason: 'NOT_ON_HR_LIST' };
        }
        if (!policy.openCode)
            return { ok: false, reason: 'OPEN_CODES_OFF' };
        return { ok: true, verifiedBy: 'CODE' };
    }
    if (!policy.domainEmail)
        return { ok: false, reason: 'NO_VERIFICATION_PATH' };
    if (!facts.email || facts.emailVerified !== true)
        return { ok: false, reason: 'EMAIL_NOT_VERIFIED' };
    const d = (0, corporate_code_1.emailDomain)(facts.email);
    const allowed = account.emailDomains.map((x) => x.trim().toLowerCase()).filter((x) => x && !exports.FREE_MAIL_DOMAINS.has(x));
    return d && allowed.includes(d) ? { ok: true, verifiedBy: 'DOMAIN_EMAIL' } : { ok: false, reason: 'EMAIL_DOMAIN_MISMATCH' };
}
//# sourceMappingURL=corporate-eligibility.js.map