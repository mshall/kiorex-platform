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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JourneyRunnerService = void 0;
exports.nextStepOf = nextStepOf;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const ids_1 = require("../../common/ids");
const patient_public_1 = require("../../patient/patient-public");
const patient_public_2 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const journey_anchor_1 = require("./journey-anchor");
const journeys_1 = require("./journeys");
const lifecycle_policy_service_1 = require("./lifecycle-policy.service");
const lifecycle_state_service_1 = require("./lifecycle-state.service");
const send_gate_service_1 = require("./send-gate.service");
const frequency_cap_1 = require("./frequency-cap");
const LEASE_MS = 5 * 60_000;
const MIN = 60_000;
function nextStepOf(def, done, params, maxSteps) {
    const applicable = def.steps.filter((s) => !s.when || s.when(params));
    const capped = maxSteps ? applicable.slice(0, maxSteps) : applicable;
    return capped.find((s) => s.step > done) ?? null;
}
let JourneyRunnerService = class JourneyRunnerService {
    prisma;
    gate;
    policies;
    state;
    consents;
    patients;
    log = new common_1.Logger('lifecycle-runner');
    constructor(prisma, gate, policies, state, consents, patients) {
        this.prisma = prisma;
        this.gate = gate;
        this.policies = policies;
        this.state = state;
        this.consents = consents;
        this.patients = patients;
    }
    async enrol(i) {
        const def = (0, journeys_1.journeyByKey)(i.journeyKey);
        if (!def)
            return { enrolled: false, reason: 'UNKNOWN_JOURNEY' };
        const now = i.now ?? new Date();
        const profile = await this.patients.profileBySub(i.sub);
        if (!profile || profile.deletedAt)
            return { enrolled: false, reason: 'NO_PERSON' };
        const market = profile.market ?? market_core_public_1.DEFAULT_MARKET;
        if (!(await this.policies.journeysOn(market)))
            return { enrolled: false, reason: 'FLAG_OFF' };
        const policy = await this.policies.resolve(market);
        if (!this.policies.journeyPolicy(policy, def).enabled)
            return { enrolled: false, reason: 'JOURNEY_DISABLED' };
        const params = i.params ?? {};
        const anchor = { id: i.anchorId ?? 'self', at: (i.anchorAt ?? now).getTime(), params };
        const journeyKey = def.anchored || i.anchorId || Object.keys(params).length ? (0, journey_anchor_1.encodeAnchor)(def.key, anchor) : def.key;
        const earlier = await this.prisma.lifecycleEnrollment.findFirst({ where: { sub: i.sub, journeyVersion: def.version, OR: [{ journeyKey: def.key }, { journeyKey: { startsWith: (0, journey_anchor_1.anchorPrefix)(def.key, anchor.id) } }] }, select: { id: true } });
        if (earlier)
            return { enrolled: false, reason: 'ALREADY_ENROLLED' };
        const first = nextStepOf(def, 0, params, policy.journeys[def.key]?.maxSteps);
        if (!first)
            return { enrolled: false, reason: 'NOT_ELIGIBLE' };
        if (def.key === 'reengagement') {
            const f = await this.state.factsFor(i.sub, now);
            const stage = f ? (await this.prisma.patientLifecycle.findUnique({ where: { sub_market: { sub: i.sub, market } }, select: { stage: true } }))?.stage : null;
            if (stage !== 'DORMANT')
                return { enrolled: false, reason: 'NOT_ELIGIBLE' };
        }
        try {
            const row = await this.prisma.lifecycleEnrollment.create({ data: { id: (0, ids_1.newId)('kx_lce'), sub: i.sub, market, journeyKey, journeyVersion: def.version, state: 'ACTIVE', step: 0, nextRunAt: new Date(anchor.at + first.delayMinutes * MIN) } });
            return { enrolled: true, id: row.id };
        }
        catch (e) {
            if (e.code === 'P2002')
                return { enrolled: false, reason: 'ALREADY_ENROLLED' };
            throw e;
        }
    }
    async stopFacts(sub, anchor, now) {
        const at = new Date(anchor?.at ?? now.getTime());
        const [profile, life, booked, review, dependant, intent, marketing] = await Promise.all([
            this.prisma.patientProfile.findUnique({ where: { sub }, select: { deletedAt: true } }),
            this.prisma.patientLifecycle.findFirst({ where: { sub }, select: { stage: true } }),
            this.prisma.bookingIntent.count({ where: { sub, createdAt: { gt: at }, status: { notIn: ['EXPIRED'] } } }),
            anchor && anchor.id !== 'self' ? this.prisma.review.count({ where: { bookingId: anchor.id } }) : Promise.resolve(0),
            this.prisma.dependant.count({ where: { guardianSub: sub, createdAt: { gt: at } } }),
            anchor && anchor.id !== 'self' ? this.prisma.bookingIntent.findUnique({ where: { id: anchor.id }, select: { status: true, depositStatus: true } }) : Promise.resolve(null),
            Promise.all(patient_public_1.MARKETING_CONSENT_PURPOSES.map((p) => this.consents.hasConsent(sub, p))),
        ]);
        return {
            bookedAfterAnchor: booked > 0, reviewedAnchor: review > 0, stage: life?.stage ?? null, marketingAnyConsent: marketing.some(Boolean),
            rewardClosed: anchor?.params.closed === true, dependantAdded: dependant > 0, accountDeleted: !profile || !!profile.deletedAt,
            depositSettled: !intent || intent.depositStatus !== 'REQUIRED' || !['INTENT', 'HELD', 'PENDING_CLINIC'].includes(intent.status), leftDormant: !!life && life.stage !== 'DORMANT',
        };
    }
    stopReason(step, f) {
        for (const c of step.stopOn) {
            if (c === 'MARKETING_CONSENT_LOST') {
                if (step.messageClass === 'MARKETING' && !f.marketingAnyConsent)
                    return c;
                continue;
            }
            if (c === 'stage')
                continue;
            if (f[c] === true)
                return c;
        }
        return null;
    }
    async end(id, reason, now) {
        await this.prisma.lifecycleEnrollment.update({ where: { id }, data: { state: 'ENDED', endedAt: now, endReason: reason, nextRunAt: null } });
    }
    async runDue(now = new Date(), limit = 200) {
        const out = { picked: 0, sent: 0, skipped: 0, deferred: 0, ended: 0, errors: 0 };
        const due = await this.prisma.lifecycleEnrollment.findMany({ where: { state: 'ACTIVE', nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: limit });
        const policies = new Map();
        for (const e of due) {
            const claim = await this.prisma.lifecycleEnrollment.updateMany({ where: { id: e.id, state: 'ACTIVE', nextRunAt: e.nextRunAt }, data: { nextRunAt: new Date(now.getTime() + LEASE_MS) } });
            if (claim.count !== 1)
                continue;
            out.picked++;
            try {
                if (!policies.has(e.market))
                    policies.set(e.market, await this.policies.resolve(e.market));
                await this.processOne(e, policies.get(e.market), now, out);
            }
            catch (err) {
                out.errors++;
                this.log.warn(`enrolment ${e.id} failed: ${err.message}`);
                await this.prisma.lifecycleEnrollment.updateMany({ where: { id: e.id, state: 'ACTIVE' }, data: { nextRunAt: new Date(now.getTime() + 15 * MIN) } });
            }
        }
        return out;
    }
    async processOne(e, policy, now, out) {
        const { key, anchor } = (0, journey_anchor_1.decodeAnchor)(e.journeyKey);
        const def = (0, journeys_1.journeyByKey)(key);
        if (!def) {
            await this.end(e.id, 'UNKNOWN_JOURNEY', now);
            out.ended++;
            return;
        }
        const params = anchor?.params ?? {};
        const step = nextStepOf(def, e.step, params, policy.journeys[def.key]?.maxSteps);
        if (!step) {
            await this.end(e.id, 'COMPLETED', now);
            out.ended++;
            return;
        }
        const market = e.market;
        if (!(await this.policies.journeysOn(market))) {
            await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0], reason: 'JOURNEY_DISABLED' });
            await this.end(e.id, 'FLAG_OFF', now);
            out.ended++;
            out.skipped++;
            return;
        }
        const jp = this.policies.journeyPolicy(policy, def);
        if (!jp.enabled) {
            await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0], reason: 'JOURNEY_DISABLED' });
            await this.end(e.id, 'JOURNEY_DISABLED', now);
            out.ended++;
            out.skipped++;
            return;
        }
        const facts = await this.stopFacts(e.sub, anchor, now);
        const stopped = this.stopReason(step, facts);
        if (stopped) {
            await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0], reason: 'STOPPED' });
            await this.end(e.id, `STOPPED:${stopped}`, now);
            out.ended++;
            out.skipped++;
            return;
        }
        if (def.key === 'reengagement' && step.messageClass === 'MARKETING') {
            const prior = await this.prisma.lifecycleMessageDecision.findMany({ where: { sub: e.sub, journeyKey: def.key, decision: 'SEND', at: { gte: new Date(now.getTime() - (def.params.windowDays ?? 90) * 86_400_000) } }, select: { at: true } });
            if (!(0, frequency_cap_1.withinWindowBudget)(prior.map((p) => p.at), now.getTime(), def.params.maxPer90Days ?? 2, def.params.windowDays ?? 90)) {
                await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0], reason: 'NOT_ELIGIBLE' });
                await this.advance(e.id, def, step, params, policy, now, out);
                out.skipped++;
                return;
            }
        }
        const marketingFlagOn = step.messageClass === 'MARKETING' ? await this.policies.marketingOn(market) : false;
        let deferUntil = null;
        let sent = false;
        for (const channel of step.channels) {
            const r = await this.gate.send({ sub: e.sub, def, step, channel, anchorId: anchor?.id ?? 'self', anchorParams: params, now, policy, marketingFlagOn, journeyEnabled: true });
            if (r.outcome.decision === 'SEND') {
                sent = true;
                out.sent++;
                break;
            }
            if (r.outcome.reason === 'QUIET_HOURS' && r.outcome.deferUntil)
                deferUntil = Math.min(deferUntil ?? Infinity, r.outcome.deferUntil);
            if (r.outcome.reason === 'MARKETING_FLAG_OFF' || r.outcome.reason === 'HOLDOUT' || r.outcome.reason === 'DUPLICATE')
                break;
        }
        if (!sent && deferUntil !== null) {
            await this.prisma.lifecycleEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(deferUntil) } });
            out.deferred++;
            return;
        }
        if (!sent)
            out.skipped++;
        await this.advance(e.id, def, step, params, policy, now, out);
    }
    async advance(id, def, done, params, policy, now, out) {
        const next = nextStepOf(def, done.step, params, policy.journeys[def.key]?.maxSteps);
        if (!next) {
            await this.prisma.lifecycleEnrollment.update({ where: { id }, data: { step: done.step, state: 'ENDED', endedAt: now, endReason: 'COMPLETED', nextRunAt: null } });
            out.ended++;
            return;
        }
        await this.prisma.lifecycleEnrollment.update({ where: { id }, data: { step: done.step, nextRunAt: new Date(now.getTime() + next.delayMinutes * MIN) } });
    }
    async recordLegacyReminder(i) {
        return this.prisma.lifecycleMessageDecision.create({ data: { id: (0, ids_1.newId)('kx_lmd'), sub: i.sub, market: i.market ?? market_core_public_1.DEFAULT_MARKET, journeyKey: 'reminders', step: i.step === 'REMINDER_24H' ? 101 : i.step === 'REMINDER_2H' ? 102 : 103, messageClass: 'TRANSACTIONAL', channel: 'ALL', templateKey: i.step, decision: i.decision, reason: i.reason, messageLogId: i.messageLogId ?? null } });
    }
    catalogue() { return journeys_1.JOURNEYS; }
};
exports.JourneyRunnerService = JourneyRunnerService;
exports.JourneyRunnerService = JourneyRunnerService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.ConsentService))),
    __param(5, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_2.PatientService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, send_gate_service_1.SendGateService, lifecycle_policy_service_1.LifecyclePolicyService, lifecycle_state_service_1.LifecycleStateService,
        patient_public_1.ConsentService, patient_public_2.PatientService])
], JourneyRunnerService);
//# sourceMappingURL=journey-runner.service.js.map