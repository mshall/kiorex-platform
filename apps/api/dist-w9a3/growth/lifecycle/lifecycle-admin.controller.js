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
exports.LifecycleAdminController = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const engagement_public_1 = require("../../engagement/engagement-public");
const messaging_public_1 = require("../../messaging/messaging-public");
const patient_public_1 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_access_1 = require("../admin/growth-access");
const growth_flags_1 = require("../growth-flags");
const journey_runner_service_1 = require("./journey-runner.service");
const lifecycle_job_1 = require("./lifecycle.job");
const lifecycle_policy_service_1 = require("./lifecycle-policy.service");
const lifecycle_state_service_1 = require("./lifecycle-state.service");
const send_gate_service_1 = require("./send-gate.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
class AddSuppressionDto {
    address;
    channel;
    note;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], AddSuppressionDto.prototype, "address", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'ALL']),
    __metadata("design:type", String)
], AddSuppressionDto.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], AddSuppressionDto.prototype, "note", void 0);
class LiftRequestDto {
    evidence;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], LiftRequestDto.prototype, "evidence", void 0);
class TestSendDto {
    kind;
    channel;
    sub;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TestSendDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['INAPP', 'WHATSAPP', 'SMS', 'EMAIL', 'PUSH']),
    __metadata("design:type", String)
], TestSendDto.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], TestSendDto.prototype, "sub", void 0);
let LifecycleAdminController = class LifecycleAdminController {
    prisma;
    policies;
    state;
    runner;
    suppression;
    engagement;
    job;
    gate;
    constructor(prisma, policies, state, runner, suppression, engagement, job, gate) {
        this.prisma = prisma;
        this.policies = policies;
        this.state = state;
        this.runner = runner;
        this.suppression = suppression;
        this.engagement = engagement;
        this.job = job;
        this.gate = gate;
    }
    async overview(market = market_core_public_1.DEFAULT_MARKET) {
        const policy = await this.policies.resolve(market);
        const active = await this.prisma.lifecycleEnrollment.findMany({ where: { state: 'ACTIVE', market }, select: { journeyKey: true } });
        const count = (key) => active.filter((a) => a.journeyKey === key || a.journeyKey.startsWith(`${key}#`)).length;
        return {
            market, flags: { lifecycleJourneys: await this.policies.journeysOn(market), marketingMessaging: await this.policies.marketingOn(market) },
            policy: { version: policy.version, source: policy.source, caps: policy.caps, quietHours: policy.quiet, holdoutBps: policy.holdoutBps },
            journeys: this.policies.catalogue().map((j) => ({
                key: j.key, trigger: j.trigger, anchored: j.anchored, describe: j.describe, enabled: this.policies.journeyPolicy(policy, j).enabled, activeEnrolments: count(j.key),
                hasMarketingStep: j.steps.some((s) => s.messageClass === 'MARKETING'),
                steps: j.steps.map((s) => ({ step: s.step, messageClass: s.messageClass, channels: s.channels, kind: s.kind, delayMinutes: s.delayMinutes })),
            })),
        };
    }
    funnel(market = market_core_public_1.DEFAULT_MARKET) { return this.state.funnel(market, 10); }
    async decisions(daysRaw = '7', market = market_core_public_1.DEFAULT_MARKET) {
        const days = Math.max(1, Math.min(90, Number(daysRaw) || 7));
        const rows = await this.prisma.lifecycleMessageDecision.groupBy({ by: ['journeyKey', 'messageClass', 'decision', 'reason'], where: { market, at: { gte: new Date(Date.now() - days * 86_400_000) } }, _count: { _all: true }, orderBy: [{ journeyKey: 'asc' }] });
        return rows.map((r) => ({ journeyKey: r.journeyKey, messageClass: r.messageClass, decision: r.decision, reason: r.reason, count: r._count._all }));
    }
    templates() {
        const sample = { doctor: 'Dr. Sample', time: 'Mon 9:00', date: '1 Jan', minutes: 10, assignee: 'Sample', patient: 'Sample', count: 3, org: 'Sample', kindLabel: 'Clinic', link: 'https://kiorex.com', status: 'Updated' };
        return (0, engagement_public_1.templateClassView)().map((v) => ({ ...v, templateId: engagement_public_1.TEMPLATES[v.kind].templateId, en: (0, engagement_public_1.render)(engagement_public_1.TEMPLATES[v.kind].en, sample), ar: (0, engagement_public_1.render)(engagement_public_1.TEMPLATES[v.kind].ar, sample) }));
    }
    async suppressions(active, take = '100') {
        const rows = await this.prisma.communicationSuppression.findMany({ where: active === '0' ? {} : { liftedAt: null }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(take) || 100) });
        return rows.map((r) => ({ id: r.id, market: r.market, channel: r.channel, reason: r.reason, source: r.source, createdAt: r.createdAt, liftedAt: r.liftedAt, hashTail: r.addressHash.slice(-6) }));
    }
    async addSuppression(u, b) {
        const row = await this.suppression.add({ address: b.address, channel: b.channel, reason: 'MANUAL', source: `ops:${u.sub}` });
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.suppression.add', resource: 'CommunicationSuppression', resourceId: row.id, metadata: { channel: b.channel, note: b.note } } });
        return { id: row.id, channel: row.channel, reason: row.reason, hashTail: row.addressHash.slice(-6) };
    }
    async liftRequest(u, id, b) {
        const row = await this.prisma.communicationSuppression.findUnique({ where: { id } });
        if (!row || row.liftedAt)
            throw (0, errors_1.notFound)('SUPPRESSION_NOT_FOUND', 'No active suppression with this id');
        const a = await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.suppression.lift_requested', resource: 'CommunicationSuppression', resourceId: id, metadata: { evidence: b.evidence } } });
        return { requestId: a.id, state: 'AWAITING_SECOND_PERSON' };
    }
    async liftApprove(u, id) {
        const req = await this.prisma.auditLog.findFirst({ where: { resource: 'CommunicationSuppression', resourceId: id, action: 'growth.lifecycle.suppression.lift_requested' }, orderBy: { createdAt: 'desc' } });
        if (!req)
            throw (0, errors_1.badRequest)('LIFT_NOT_REQUESTED', 'Nobody asked to lift this suppression yet');
        if (req.actor === u.sub)
            throw new common_1.ForbiddenException({ code: 'GROWTH_CONFIG_SELF_APPROVAL', message: 'The person who asked cannot approve it' });
        const r = await this.prisma.communicationSuppression.updateMany({ where: { id, liftedAt: null }, data: { liftedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.notFound)('SUPPRESSION_NOT_FOUND', 'No active suppression with this id');
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.suppression.lifted', resource: 'CommunicationSuppression', resourceId: id, metadata: { requestedBy: req.actor, requestId: req.id } } });
        return { lifted: true };
    }
    async testSend(u, b) {
        if (!(b.kind in engagement_public_1.TEMPLATES))
            throw (0, errors_1.badRequest)('UNKNOWN_TEMPLATE', 'Unknown template kind');
        if (b.channel !== 'INAPP' && (0, messaging_public_1.channelMode)(b.channel) !== 'mock')
            throw new common_1.ForbiddenException({ code: 'TEST_SEND_MOCK_ONLY', message: 'Test sends only run while the channel is in mock mode' });
        const allow = (process.env.LIFECYCLE_TEST_SUBS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const sub = b.sub ?? allow[0];
        if (!sub || !allow.includes(sub))
            throw new common_1.ForbiddenException({ code: 'TEST_SEND_NOT_ALLOWLISTED', message: 'The recipient is not on the staff test allowlist (LIFECYCLE_TEST_SUBS)' });
        const ids = await this.engagement.notify(sub, { kind: b.kind, params: {}, dedupeKey: `lc-test:${u.sub}:${Date.now()}`, channels: [b.channel], exact: true });
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.test_send', resource: 'Message', resourceId: ids[0] ?? null, metadata: { kind: b.kind, channel: b.channel } } });
        return { messageIds: ids };
    }
    async lookup(u, sub) {
        if (!sub || sub.length > 120)
            throw new common_1.BadRequestException('sub is required');
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.lookup', resource: 'LifecycleMessageDecision', metadata: { subHash: (0, privacy_hash_1.addressHash)(sub).slice(0, 12) } } });
        return this.prisma.lifecycleMessageDecision.findMany({ where: { sub }, orderBy: { at: 'desc' }, take: 100, select: { journeyKey: true, step: true, messageClass: true, channel: true, templateKey: true, decision: true, reason: true, at: true } });
    }
    run() { return this.job.runOnce(); }
};
exports.LifecycleAdminController = LifecycleAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E journeys with their steps, class, policy state and active enrolments; the policy in force' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('funnel'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E stage funnel; a stage with fewer than 10 people shows no count' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], LifecycleAdminController.prototype, "funnel", null);
__decorate([
    (0, common_1.Get)('decisions'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E send-gate decisions by journey, decision and reason code over the last N days (aggregate)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('days')),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "decisions", null);
__decorate([
    (0, common_1.Get)('templates'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E template catalogue: class badge, purpose, copy review state, AR and EN preview with sample parameters' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], LifecycleAdminController.prototype, "templates", null);
__decorate([
    (0, common_1.Get)('suppressions'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E suppression list (channel, reason, source, hash tail; never the address)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('active')),
    __param(1, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "suppressions", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('suppressions'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E add a manual suppression (reason MANUAL, a written note is required, audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, AddSuppressionDto]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "addSuppression", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('suppressions/:id/lift-request'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E first person: ask to lift a suppression, with documented consent evidence' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, LiftRequestDto]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "liftRequest", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('suppressions/:id/lift-approve'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E second person (never the requester): lift the suppression' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "liftApprove", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.LIFECYCLE_JOURNEYS),
    (0, common_1.Post)('test-send'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E send one template to an allowlisted staff subject, only while the channel runs in mock mode' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, TestSendDto]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "testSend", null);
__decorate([
    (0, common_1.Get)('lookup'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E audited lookup of one subject decisions (DPO use): every call writes an audit row' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('sub')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LifecycleAdminController.prototype, "lookup", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.LIFECYCLE_JOURNEYS),
    (0, common_1.Post)('run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E run the one-minute tick once (idempotent; also what the job does)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], LifecycleAdminController.prototype, "run", null);
exports.LifecycleAdminController = LifecycleAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-lifecycle'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/lifecycle'),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.SuppressionService))),
    __param(5, (0, common_1.Inject)((0, common_1.forwardRef)(() => engagement_public_1.EngagementService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, lifecycle_policy_service_1.LifecyclePolicyService, lifecycle_state_service_1.LifecycleStateService, journey_runner_service_1.JourneyRunnerService,
        patient_public_1.SuppressionService, engagement_public_1.EngagementService, lifecycle_job_1.LifecycleJob, send_gate_service_1.SendGateService])
], LifecycleAdminController);
//# sourceMappingURL=lifecycle-admin.controller.js.map