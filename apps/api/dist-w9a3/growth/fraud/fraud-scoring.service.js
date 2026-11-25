"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FraudScoringService = exports.FRAUD_SCORING_FLAG = void 0;
const common_1 = require("@nestjs/common");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_limiter_1 = require("../growth-limiter");
const growth_flags_1 = require("../growth-flags");
const case_service_1 = require("./case.service");
const engine_1 = require("./engine");
const fraud_config_service_1 = require("./fraud-config.service");
const fraud_hold_service_1 = require("./fraud-hold.service");
const NONE = { action: 'NONE', shadowAction: 'NONE', band: 'ALLOW', score: 0, caseId: null };
const HOUR = 3_600_000;
exports.FRAUD_SCORING_FLAG = 'growth.fraud_scoring';
let FraudScoringService = class FraudScoringService {
    cfg;
    cases;
    hold;
    flags;
    limiter;
    log = new common_1.Logger('fraud-scoring');
    constructor(cfg, cases, hold, flags, limiter) {
        this.cfg = cfg;
        this.cases = cases;
        this.hold = hold;
        this.flags = flags;
        this.limiter = limiter;
    }
    async assess(surface, features, ctx) {
        const market = ctx.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        try {
            if (!(await this.flags.isEnabled(exports.FRAUD_SCORING_FLAG, { market })))
                return NONE;
            const cfg = await this.cfg.get(market);
            const ev = (0, engine_1.evaluateFraud)(cfg, surface, features);
            if (!ev.signals.length)
                return NONE;
            const rec = await this.cases.record(ev, { market, subject: ctx.subject, evidenceRef: ctx.evidenceRef, cfg });
            if (ev.action !== 'NONE')
                await this.hold.apply(ev.action, { relationshipIds: ctx.relationshipIds ?? [], touchRef: ctx.touchRef, originRef: ctx.originRef });
            return { action: ev.action, shadowAction: ev.shadowAction, band: ev.shadow.band, score: ev.shadow.score, caseId: rec?.id ?? null };
        }
        catch (e) {
            this.log.warn(`assess ${surface} failed: ${e.message}`);
            return NONE;
        }
    }
    async count(key, windowMs) { await this.limiter.limiter.hit(key, 1_000_000, windowMs); }
    async atLeast(key, n, windowMs) { return !(await this.limiter.limiter.blocked(key, n, windowMs)).ok; }
    async onTouch(t) {
        if (!t.burst && !t.clickWithoutRender)
            return null;
        const cfg = await this.cfg.get().catch(() => null);
        if (!cfg)
            return null;
        const day = t.day ?? new Date().toISOString().slice(0, 10);
        return this.assess('TOUCH', { ...(t.burst ? { touchBurstPerMinute: t.burstLimit + 1, touchBurstLimit: t.burstLimit } : {}), clickWithoutRender: t.clickWithoutRender }, { subject: `ip:${t.ipHash}`, evidenceRef: `touch:burst:${day}` });
    }
    async onLinkToken(t) {
        try {
            const { thresholds } = await this.cfg.get();
            if (!t.ok && !t.expired)
                return this.assess('TOUCH', { ltSignatureInvalid: true }, { subject: `ip:${t.ipHash}`, evidenceRef: `lt:invalid:${new Date().toISOString().slice(0, 10)}` });
            if (!t.tokenId)
                return null;
            const use = `fraud:lt:use:${t.tokenId}`;
            await this.count(use, HOUR);
            const pair = `fraud:lt:pair:${t.tokenId}:${t.ipHash}`;
            if ((await this.limiter.limiter.hit(pair, 1, HOUR)).ok)
                await this.count(`fraud:lt:subjects:${t.tokenId}`, HOUR);
            const useCount = (await this.atLeast(use, thresholds.ltUseCountLimit + 1, HOUR)) ? thresholds.ltUseCountLimit + 1 : 0;
            const subjects = (await this.atLeast(`fraud:lt:subjects:${t.tokenId}`, thresholds.ltDistinctSubjectsLimit, HOUR)) ? thresholds.ltDistinctSubjectsLimit : 0;
            if (!useCount && !subjects && !t.expired)
                return null;
            return this.assess('TOUCH', { ltUseCount: useCount, ltDistinctSubjects: subjects, ltUsedAfterExpiry: !!t.expired }, { subject: `lt:${t.tokenId}`, evidenceRef: `lt:${t.tokenId}` });
        }
        catch {
            return null;
        }
    }
    originRef(origin) { return (0, privacy_hash_1.subRefOf)(`origin:${(origin ?? '').toLowerCase()}`).slice(0, 16); }
    async onWidgetDenied(t) {
        try {
            const { thresholds } = await this.cfg.get();
            const ref = this.originRef(t.origin);
            const f = {};
            if (t.reason === 'ORIGIN_MISMATCH' || t.reason === 'ORIGIN_NOT_ALLOWED' || t.reason === 'REFERER_NOT_ALLOWED') {
                const k = `fraud:wd:mismatch:${ref}`;
                await this.count(k, HOUR);
                if (await this.atLeast(k, thresholds.widgetOriginMismatches, HOUR))
                    f.widgetOriginMismatches = thresholds.widgetOriginMismatches;
                if (t.org) {
                    if ((await this.limiter.limiter.hit(`fraud:wd:pair:${t.org}:${ref}`, 1, HOUR)).ok)
                        await this.count(`fraud:wd:origins:${t.org}`, HOUR);
                    if (await this.atLeast(`fraud:wd:origins:${t.org}`, thresholds.widgetDistinctOriginsPerKey1h, HOUR))
                        f.widgetDistinctOriginsPerKey1h = thresholds.widgetDistinctOriginsPerKey1h;
                }
            }
            if (t.reason === 'TOKEN_INVALID') {
                const k = `fraud:wd:replay:${ref}`;
                await this.count(k, HOUR);
                if (await this.atLeast(k, thresholds.widgetTokenReplays, HOUR))
                    f.widgetTokenReplays = thresholds.widgetTokenReplays;
            }
            if (Object.keys(f).length)
                await this.assess('WIDGET', f, { subject: `widget:${ref}`, evidenceRef: `widget:${ref}`, originRef: ref });
        }
        catch { }
    }
    async originThrottled(origin) {
        if (!origin)
            return false;
        try {
            return await this.hold.originThrottled(this.originRef(origin));
        }
        catch {
            return false;
        }
    }
};
exports.FraudScoringService = FraudScoringService;
exports.FraudScoringService = FraudScoringService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [fraud_config_service_1.FraudConfigService, case_service_1.FraudCaseService, fraud_hold_service_1.FraudHoldService, control_plane_public_1.FlagsService, growth_limiter_1.GrowthLimiter])
], FraudScoringService);
//# sourceMappingURL=fraud-scoring.service.js.map