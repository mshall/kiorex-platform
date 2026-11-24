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
exports.SendGateService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const messaging_public_1 = require("../../messaging/messaging-public");
const engagement_public_1 = require("../../engagement/engagement-public");
const patient_public_1 = require("../../patient/patient-public");
const patient_public_2 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const safety_public_1 = require("../../safety/safety-public");
const ids_1 = require("../../common/ids");
const frequency_cap_1 = require("./frequency-cap");
const quiet_hours_1 = require("./quiet-hours");
const send_gate_1 = require("./send-gate");
const consentKeyOf = (purpose, channel) => purpose === 'REMINDER' ? 'REMINDERS' : purpose === 'MARKETING' ? `MARKETING_${channel === 'INAPP' ? 'PUSH' : channel}` : 'MARKETPLACE_PROCESSING';
let SendGateService = class SendGateService {
    prisma;
    patients;
    consents;
    suppression;
    engagement;
    prefCentre;
    constructor(prisma, patients, consents, suppression, engagement, prefCentre) {
        this.prisma = prisma;
        this.patients = patients;
        this.consents = consents;
        this.suppression = suppression;
        this.engagement = engagement;
        this.prefCentre = prefCentre;
    }
    dedupeKeyOf(r) { return `lc:${r.def.key}:${r.step.step}:${r.anchorId}:${r.sub}`; }
    async evaluate(r) {
        const { sub, step, channel, now } = r;
        const profile = await this.patients.profileBySub(sub);
        const market = profile?.market ?? market_core_public_1.DEFAULT_MARKET;
        const marketing = step.messageClass === 'MARKETING';
        const consentKey = consentKeyOf(step.purpose, channel);
        const [consent, pref, devices] = await Promise.all([
            step.messageClass === 'SECURITY' || step.messageClass === 'CLINICAL' ? Promise.resolve(true) : this.consents.hasConsent(sub, consentKey),
            this.prisma.notificationPreference.findUnique({ where: { sub_channel: { sub, channel } } }),
            channel === 'PUSH' ? this.engagement.activeDevices(sub) : Promise.resolve([]),
        ]);
        const addresses = channel === 'EMAIL' ? [profile?.email] : channel === 'PUSH' || channel === 'INAPP' ? [] : [profile?.phone];
        const suppressed = marketing && channel !== 'INAPP' ? await this.suppression.isSuppressed(addresses, channel, market) : false;
        const sent = marketing ? await this.engagement.marketingSentSince(sub, new Date(now.getTime() - 7 * 86_400_000), null) : [];
        const counts = (0, frequency_cap_1.capCounts)(sent, now.getTime());
        const centre = await this.prefCentre.consentDefaults(market);
        const caps = { perDay: Math.min(r.policy.caps.perDay, centre.maxMarketingPerDay), perWeek: Math.min(r.policy.caps.perWeek, centre.maxMarketingPerWeek) };
        const t = engagement_public_1.TEMPLATES[step.kind];
        const params = this.paramsFor(r);
        const text = `${(0, engagement_public_1.render)(t.en, (0, engagement_public_1.humanizeTimes)(params, 'en', (0, market_core_public_1.marketTimezone)(market)))}\n${(0, engagement_public_1.render)(t.ar, (0, engagement_public_1.humanizeTimes)(params, 'ar', (0, market_core_public_1.marketTimezone)(market)))}`;
        const dedupeKey = `${this.dedupeKeyOf(r)}:${channel}`;
        const dup = await this.prisma.message.findUnique({ where: { dedupeKey }, select: { id: true } });
        const mock = channel === 'INAPP' ? true : (0, messaging_public_1.channelMode)(channel) === 'mock';
        const input = {
            messageClass: step.messageClass, channel, now: now.getTime(), critical: false, quietBypass: t.bypassQuiet === true,
            journeyEnabled: r.journeyEnabled, marketingFlagOn: r.marketingFlagOn,
            inHoldout: marketing && (0, frequency_cap_1.inHoldout)(sub, r.def.key, r.policy.holdoutBps),
            consent, channelOptedOut: !!pref && !pref.enabled, suppressed,
            quiet: (0, quiet_hours_1.quietWindow)(r.policy.quiet, pref ? { start: pref.quietStart, end: pref.quietEnd } : null),
            sentDay: counts.day, sentWeek: counts.week, caps,
            whatsappWindowOpen: false,
            templateApproved: mock || !t.templateId.startsWith('TODO_NEEDS_HUMAN'),
            hasAddress: channel === 'INAPP' ? true : channel === 'PUSH' ? devices.length > 0 || mock : channel === 'EMAIL' ? !!profile?.email : !!profile?.phone,
            phiHits: (0, safety_public_1.detectPhi)(text), duplicate: !!dup,
        };
        return { outcome: (0, send_gate_1.evaluateSendGate)(input), input, params };
    }
    paramsFor(r) {
        const t = engagement_public_1.TEMPLATES[r.step.kind];
        const allowed = new Set([...t.en.matchAll(/\{(\w+)\}/g), ...t.ar.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
        return Object.fromEntries(Object.entries(r.anchorParams).filter(([k, v]) => allowed.has(k) && (typeof v === 'string' || typeof v === 'number')));
    }
    async send(r) {
        const { outcome, params } = await this.evaluate(r);
        let messageId = null;
        if (outcome.decision === 'SEND') {
            const ids = await this.engagement.notify(r.sub, { kind: r.step.kind, params, dedupeKey: this.dedupeKeyOf(r), channels: [r.channel], exact: true });
            messageId = ids[0] ?? null;
        }
        const decision = await this.prisma.lifecycleMessageDecision.create({
            data: { id: (0, ids_1.newId)('kx_lmd'), sub: r.sub, market: (await this.patients.profileBySub(r.sub))?.market ?? market_core_public_1.DEFAULT_MARKET, journeyKey: r.def.key, step: r.step.step, messageClass: r.step.messageClass, channel: r.channel, templateKey: r.step.kind, decision: outcome.decision, reason: outcome.reason, messageLogId: messageId },
        });
        return { outcome, decisionId: decision.id, messageId, channel: r.channel };
    }
    async record(i) {
        return this.prisma.lifecycleMessageDecision.create({ data: { id: (0, ids_1.newId)('kx_lmd'), sub: i.sub, market: i.market, journeyKey: i.def.key, step: i.step.step, messageClass: i.step.messageClass, channel: i.channel, templateKey: i.step.kind, decision: i.decision ?? 'SKIP', reason: i.reason } });
    }
};
exports.SendGateService = SendGateService;
exports.SendGateService = SendGateService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_2.PatientService))),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.ConsentService))),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.SuppressionService))),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => engagement_public_1.EngagementService))),
    __param(5, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PreferenceCentreService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, patient_public_2.PatientService, patient_public_1.ConsentService,
        patient_public_1.SuppressionService, engagement_public_1.EngagementService, patient_public_1.PreferenceCentreService])
], SendGateService);
//# sourceMappingURL=send-gate.service.js.map