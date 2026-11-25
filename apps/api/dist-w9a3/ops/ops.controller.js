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
exports.OpsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const homecare_public_1 = require("../homecare/homecare-public");
const auth_1 = require("../common/auth");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const engagement_public_1 = require("../engagement/engagement-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const messaging_public_1 = require("../messaging/messaging-public");
const ops_dto_1 = require("./ops.dto");
const outbox_public_1 = require("../outbox/outbox-public");
const pay_public_1 = require("../pay/pay-public");
const prisma_service_1 = require("../prisma/prisma.service");
const trust_public_1 = require("../trust/trust-public");
class RefundBody {
    paymentId;
    reason;
    amountMinor;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RefundBody.prototype, "paymentId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], RefundBody.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_147_483_647),
    __metadata("design:type", Number)
], RefundBody.prototype, "amountMinor", void 0);
class PaymentReviewBody {
    reason;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentReviewBody.prototype, "reason", void 0);
class SimulateBody {
    state;
}
__decorate([
    (0, class_validator_1.IsIn)(['DELIVERED', 'READ', 'FAILED']),
    __metadata("design:type", String)
], SimulateBody.prototype, "state", void 0);
class ResolveBody {
    resolution;
}
__decorate([
    (0, class_validator_1.IsIn)(['RESTORED', 'KEPT_HIDDEN']),
    __metadata("design:type", String)
], ResolveBody.prototype, "resolution", void 0);
class SettlementLine {
    psp;
    pspRef;
    kind;
    amountMinor;
    feeMinor;
    date;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], SettlementLine.prototype, "psp", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], SettlementLine.prototype, "pspRef", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['CAPTURE', 'REFUND']),
    __metadata("design:type", String)
], SettlementLine.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(2_147_483_647),
    __metadata("design:type", Number)
], SettlementLine.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(2_147_483_647),
    __metadata("design:type", Number)
], SettlementLine.prototype, "feeMinor", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], SettlementLine.prototype, "date", void 0);
class ImportBody {
    lines;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20_000),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => SettlementLine),
    __metadata("design:type", Array)
], ImportBody.prototype, "lines", void 0);
let OpsController = class OpsController {
    catalog;
    bookings;
    outbox;
    pay;
    trust;
    kiorly;
    prisma;
    engagement;
    hub;
    flags;
    safety;
    constructor(catalog, bookings, outbox, pay, trust, kiorly, prisma, engagement, hub, flags, safety) {
        this.catalog = catalog;
        this.bookings = bookings;
        this.outbox = outbox;
        this.pay = pay;
        this.trust = trust;
        this.kiorly = kiorly;
        this.prisma = prisma;
        this.engagement = engagement;
        this.hub = hub;
        this.flags = flags;
        this.safety = safety;
    }
    providers(status, q, page) { return this.catalog.opsList({ status, q, page: page ? Number(page) : 1 }); }
    syncProviders(full) { return this.catalog.syncOnce({ full: full === 'true' }); }
    bookingsList(status, clinicId, sub) { return this.bookings.opsList({ status, clinicId, sub }); }
    timeline(id) { return this.bookings.opsTimeline(id); }
    async outboxList(status, type) { return { stats: await this.outbox.stats(), items: await this.outbox.list({ status, type }) }; }
    async replay(u, id) {
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'outbox.replay', resource: 'OutboxEvent', resourceId: id } });
        return this.outbox.replay(id);
    }
    payments() { return this.pay.dashboard(); }
    async refund(u, b) {
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'pay.ops_refund', resource: 'PaymentIntent', resourceId: b.paymentId, metadata: { reason: b.reason, amountMinor: b.amountMinor } } });
        return this.pay.refund(b.paymentId, { reason: `OPS:${b.reason}`, amountMinor: b.amountMinor, idempotencyKey: `ops-refund:${b.paymentId}:${b.amountMinor ?? 'full'}:${b.reason}` });
    }
    heldForReview() { return this.pay.heldForReview(); }
    reviewRelease(u, id, b) { return this.pay.reviewRelease(id, u.sub, b.reason); }
    reviewRefund(u, id, b) { return this.pay.reviewRefund(id, u.sub, b.reason); }
    async homeGate() {
        const m = await this.catalog.homeGateMetric();
        const board = await this.flags.gateBoard();
        const gates = {};
        for (const id of ['GHV1', 'GHV2'])
            gates[id] = { recordedFor: board.gates.find((g) => g.gateId === id)?.flags.filter((f) => f.evidence).map((f) => f.key) ?? [], requiredFor: board.gates.find((g) => g.gateId === id)?.flags.map((f) => f.key) ?? [] };
        return { ...m, gates, safetyConsoleLive: !!this.safety };
    }
    async feeStatements(from, to) {
        const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
        const t = to ? new Date(to) : new Date(Date.now() + 86400_000);
        return this.pay.feeStatement({ from: f, to: t });
    }
    runPayouts() { return this.pay.runPayouts(); }
    reconcilePsp(date) { return this.pay.reconcileDaily(date ? new Date(date) : new Date()); }
    importLines(b) { return this.pay.importSettlementLines(b.lines); }
    reconcileBookings() { return this.bookings.reconcileNightly(); }
    runs() { return this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }); }
    queue(status) { return this.trust.queue(status); }
    resolve(u, id, b) { return this.trust.resolve(u.sub, id, b.resolution); }
    complaints(status) { return this.trust.complaints(status); }
    resolveComplaint(id) { return this.trust.resolveComplaint(id); }
    liquidity(days) { return this.bookings.liquidity(days ? Number(days) : 30); }
    circuits() { return this.kiorly.circuitStates(); }
    messages() { return this.engagement.messageLog(); }
    messagingStats() { return this.hub.stats(); }
    async messagingLog(channel, status, direction, limit) {
        const rows = await this.hub.list({ channel, status, direction, limit: limit ? Number(limit) : 100 });
        return { mode: this.hub.mode(), items: rows.map(({ recipient: _r, ...m }) => m) };
    }
    async messagingSimulate(id, b) { const { recipient: _r, ...m } = await this.hub.simulate(id, b.state); return m; }
    messagingTick() { return this.hub.simulateDeliveries(); }
    auditLog() { return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); }
};
exports.OpsController = OpsController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.OpsProviderListDto }),
    (0, common_1.Get)('providers'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-01 provider directory' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "providers", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.SyncResultDto }),
    (0, common_1.Post)('providers/sync'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Query)('full')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "syncProviders", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.OpsBookingDto, isArray: true }),
    (0, common_1.Get)('bookings'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-02 bookings' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('clinicId')),
    __param(2, (0, common_1.Query)('sub')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "bookingsList", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.BookingTimelineOpsDto }),
    (0, common_1.Get)('bookings/:id/timeline'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-02 booking timeline: intents, holds, Kiorly calls, events, payments' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "timeline", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.OutboxListDto }),
    (0, common_1.Get)('outbox'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-03 outbox monitor' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "outboxList", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ReplayResultDto }),
    (0, common_1.Post)('outbox/:id/replay'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-03 replay a DEAD/FAILED event' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "replay", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.PaymentsDashboardDto }),
    (0, common_1.Get)('payments/dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-04 refunds, payouts, reconciliation dashboard' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "payments", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.RefundDto }),
    (0, common_1.Post)('payments/refund'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, RefundBody]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "refund", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.HeldDepositDto, isArray: true }),
    (0, common_1.Get)('payments/held-for-review'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMPAY07 deposits of unsafe-aborted home visits held for ops review (never auto-forfeited)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "heldForReview", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ReviewDecisionDto }),
    (0, common_1.Post)('payments/:paymentId/review/release'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXMPAY07 review decision: release the held deposit to the provider (reason required, audited)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('paymentId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PaymentReviewBody]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "reviewRelease", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ReviewDecisionDto }),
    (0, common_1.Post)('payments/:paymentId/review/refund'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXMPAY07 review decision: refund the held deposit to the patient (reason required, audited)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('paymentId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PaymentReviewBody]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "reviewRefund", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.HomeGateMetricDto }),
    (0, common_1.Get)('home-visits/gate-metric'),
    (0, swagger_1.ApiOperation)({ summary: 'Home-visit release gate: >=50 home-enabled providers per launch cluster, GHV1/GHV2 evidence state, safety console live. The metric never satisfies a gate' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "homeGate", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.FeeStatementDto }),
    (0, common_1.Get)('fee-statements'),
    (0, swagger_1.ApiOperation)({ summary: 'Kiorex\'s own marketplace fee statement per partner (pharmacy/lab take); VAT is a config line.' }),
    __param(0, (0, common_1.Query)('from')),
    __param(1, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "feeStatements", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.PayoutRunDto }),
    (0, common_1.Post)('payouts/run'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "runPayouts", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ReconciliationRunDto }),
    (0, common_1.Post)('reconciliation/psp/run'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "reconcilePsp", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ImportResultDto }),
    (0, common_1.Post)('reconciliation/psp/import'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ImportBody]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "importLines", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ description: 'Nightly booking reconciliation counters', schema: { type: 'object', additionalProperties: true } }),
    (0, common_1.Post)('reconciliation/bookings/run'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "reconcileBookings", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ReconciliationRunDto, isArray: true }),
    (0, common_1.Get)('reconciliation/runs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "runs", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ModerationCaseDto, isArray: true }),
    (0, common_1.Get)('moderation'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-05 review moderation queue' }),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "queue", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.OpsOkDto }),
    (0, common_1.Post)('moderation/:id/resolve'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ResolveBody]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "resolve", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.ComplaintDto, isArray: true }),
    (0, common_1.Get)('complaints'),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "complaints", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.OpsOkDto }),
    (0, common_1.Post)('complaints/:id/resolve'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "resolveComplaint", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.LiquidityDto }),
    (0, common_1.Get)('liquidity'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-OP-06 cluster liquidity metrics' }),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "liquidity", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.CircuitDto, isArray: true }),
    (0, common_1.Get)('circuits'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "circuits", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.OpsMessageDto, isArray: true }),
    (0, common_1.Get)('messages'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "messages", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_public_1.MessagingStatsDto }),
    (0, common_1.Get)('messaging/stats'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: unified messaging (email/whatsapp/sms/push) mode and counts per channel/status' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "messagingStats", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_public_1.MessageLogDto }),
    (0, common_1.Get)('messaging/log'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: unified message log (recipient masked; body only present in mock mode)' }),
    __param(0, (0, common_1.Query)('channel')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('direction')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "messagingLog", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_public_1.MessageLogItemDto }),
    (0, common_1.Post)('messaging/log/:id/simulate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP (mock mode): move a message to DELIVERED / READ / FAILED to exercise delivery handling' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, SimulateBody]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "messagingSimulate", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_public_1.DeliveryTickDto }),
    (0, common_1.Post)('messaging/delivery-tick'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "messagingTick", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ops_dto_1.AuditLogDto, isArray: true }),
    (0, common_1.Get)('audit-log'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "auditLog", null);
exports.OpsController = OpsController = __decorate([
    (0, swagger_1.ApiTags)('ops'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [catalog_public_1.CatalogService, booking_public_1.BookingService, outbox_public_1.OutboxService, pay_public_1.PayService, trust_public_1.TrustService,
        kiorly_public_1.KiorlyClient, prisma_service_1.PrismaService, engagement_public_1.EngagementService, messaging_public_1.MessagingHub, control_plane_public_1.FlagsService, homecare_public_1.SafetyService])
], OpsController);
//# sourceMappingURL=ops.controller.js.map