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
exports.RewardsAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const config_1 = require("../../common/config");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_access_1 = require("../admin/growth-access");
const growth_flags_1 = require("../growth-flags");
const goodwill_service_1 = require("./goodwill.service");
const reward_finance_service_1 = require("./reward-finance.service");
const reward_hold_service_1 = require("./reward-hold.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_reconcile_job_1 = require("./reward-reconcile.job");
const reward_reversal_service_1 = require("./reward-reversal.service");
const reward_expiry_job_1 = require("./reward-expiry.job");
const reward_policy_service_1 = require("./reward-policy.service");
const goodwill_limits_1 = require("./goodwill-limits");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
const SUB = /^[A-Za-z0-9_.:@|-]{3,128}$/;
class ManualIssueBody {
    sub;
    amountMinor;
    reason;
    bookingId;
    ticketRef;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(SUB),
    __metadata("design:type", String)
], ManualIssueBody.prototype, "sub", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100_000_000),
    __metadata("design:type", Number)
], ManualIssueBody.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], ManualIssueBody.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ManualIssueBody.prototype, "bookingId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ManualIssueBody.prototype, "ticketRef", void 0);
class GoodwillBody {
    sub;
    reason;
    amountMinor;
    bookingId;
    ticketRef;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(SUB),
    __metadata("design:type", String)
], GoodwillBody.prototype, "sub", void 0);
__decorate([
    (0, class_validator_1.IsIn)([...goodwill_limits_1.GOODWILL_REASONS]),
    __metadata("design:type", String)
], GoodwillBody.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100_000_000),
    __metadata("design:type", Number)
], GoodwillBody.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], GoodwillBody.prototype, "bookingId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], GoodwillBody.prototype, "ticketRef", void 0);
class HoldBody {
    reasonCode;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], HoldBody.prototype, "reasonCode", void 0);
class DecideBody {
    decision;
    note;
}
__decorate([
    (0, class_validator_1.IsIn)(['APPROVED', 'REJECTED']),
    __metadata("design:type", String)
], DecideBody.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], DecideBody.prototype, "note", void 0);
let RewardsAdminController = class RewardsAdminController {
    prisma;
    ledger;
    holds;
    finance;
    goodwill;
    reconcile;
    expiry;
    policy;
    reversal;
    constructor(prisma, ledger, holds, finance, goodwill, reconcile, expiry, policy, reversal) {
        this.prisma = prisma;
        this.ledger = ledger;
        this.holds = holds;
        this.finance = finance;
        this.goodwill = goodwill;
        this.reconcile = reconcile;
        this.expiry = expiry;
        this.policy = policy;
        this.reversal = reversal;
    }
    async overview() {
        const { rules, versionId, source } = await this.policy.rewardRules();
        return {
            mode: rules.mode, effectiveMode: await this.policy.issueMode(rules), ruleVersionId: versionId, source, flags: { rewards: await this.policy.rewardsOn(), patientCredit: await this.policy.creditOn(), refundAsCredit: await this.policy.refundCreditAvailable(rules), family: await this.policy.familyAvailable(rules), goodwill: await this.policy.goodwillOn(), referral: await this.policy.referralOn() },
            amounts: rules.amounts, postToPayLedger: rules.postToPayLedger,
            banner: (0, config_1.cfg)().depositDefaultMinor === 0 && (0, config_1.cfg)().homeDepositDefaultMinor === 0 ? 'NO_DEPOSIT_CONFIGURED' : null,
            openApprovals: await this.prisma.rewardApprovalRequest.count({ where: { status: 'PENDING' } }),
        };
    }
    async lots(status, kind, funding, take) {
        const rows = await this.prisma.rewardLot.findMany({ where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(funding ? { funding } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(take) || 50, 200) });
        return Promise.all(rows.map(async (l) => { const b = await this.ledger.balance(this.prisma, l.id); return { id: l.id, patientRef: (0, privacy_hash_1.subRefOf)(l.ownerSub ?? l.sub), kind: l.kind, mode: l.mode, funding: l.funding, status: l.status, amountMinor: l.amountMinor, currency: l.currency, availableMinor: b.available, heldMinor: b.held, reservedMinor: b.reserved, expiresAt: l.expiresAt, createdAt: l.createdAt, campaignId: l.campaignId, ruleVersionId: l.ruleVersionId }; }));
    }
    async lotLedger(id) {
        const lot = await this.prisma.rewardLot.findUnique({ where: { id } });
        if (!lot)
            throw new errors_1.ApiError(404, 'REWARD_LOT_NOT_FOUND', 'Reward lot not found');
        return (await this.prisma.rewardLedgerEntry.findMany({ where: { lotId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((e) => ({ id: e.id, type: e.type, amountMinor: e.amountMinor, reasonCode: e.reasonCode, bookingId: e.bookingId, refundId: e.refundId, actor: e.actor, idempotencyKey: e.idempotencyKey, createdAt: e.createdAt }));
    }
    manualIssue(u, b) { return this.goodwill.manualIssue(u, b); }
    hold(u, id, b) { return this.holds.hold(id, (b.reasonCode ?? 'FRAUD_HOLD').replace(/[^A-Z0-9_]/gi, '_').toUpperCase(), u.sub); }
    release(u, id) { return this.holds.release(id, u.sub); }
    reverse(u, id, b) { return this.reversal.reverseLot(id, (b.reasonCode ?? 'MANUAL_REVERSAL').replace(/[^A-Z0-9_]/gi, '_').toUpperCase(), u.sub); }
    approvals() { return this.goodwill.pending(); }
    decide(u, id, b) { return this.goodwill.decide(u, id, b.decision, b.note); }
    async financeReport(month, format) {
        const r = await this.finance.report(month ?? new Date().toISOString().slice(0, 7));
        return format === 'csv' ? { csv: this.finance.csv(r) } : r;
    }
    async financeCsv(month) { return this.finance.csv(await this.finance.report(month ?? new Date().toISOString().slice(0, 7))); }
    runExpiry() { return this.expiry.runOnce(); }
    creditLots(take) { return this.lots(undefined, undefined, undefined, take).then((l) => l.filter((x) => x.mode === 'CREDIT' || x.funding === 'PATIENT_REFUND')); }
    grantGoodwill(u, b) { return this.goodwill.grant(u, b); }
    reconcileRuns() { return this.reconcile.latest(); }
    runReconcile() { return this.reconcile.run(); }
};
exports.RewardsAdminController = RewardsAdminController;
__decorate([
    (0, common_1.Get)('rewards'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 rules summary, mode, switches and the pricing note' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RewardsAdminController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('rewards/lots'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 lots with balances (patient as an opaque reference)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('kind')),
    __param(2, (0, common_1.Query)('funding')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], RewardsAdminController.prototype, "lots", null);
__decorate([
    (0, common_1.Get)('rewards/lots/:id/ledger'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 every entry of one lot (append-only)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RewardsAdminController.prototype, "lotLedger", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.REWARDS),
    (0, common_1.Post)('rewards/manual-issue'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 manual issuance: reason, daily cap per actor, second approver above the threshold' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ManualIssueBody]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "manualIssue", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('rewards/lots/:id/hold'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 freeze the available part of a lot (fraud review)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, HoldBody]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "hold", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('rewards/lots/:id/release'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 release a hold' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "release", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('rewards/lots/:id/reverse'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 reverse the unspent part of a lot found fraudulent (never a refund credit or restored lot: the patient\'s own money)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, HoldBody]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "reverse", null);
__decorate([
    (0, common_1.Get)('rewards/approvals'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 pending second-approver requests (manual issue, goodwill)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "approvals", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('rewards/approvals/:id/decide'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 approve or reject (never the requester)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, DecideBody]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "decide", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('readFinance')),
    (0, common_1.Get)('rewards/finance'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 finance report for a month (YYYY-MM): issued, redeemed, reversed, expired, outstanding; format=csv exports' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('month')),
    __param(1, (0, common_1.Query)('format')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RewardsAdminController.prototype, "financeReport", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('readFinance')),
    (0, common_1.Get)('rewards/finance.csv'),
    (0, common_1.Header)('content-type', 'text/csv; charset=utf-8'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 finance report as CSV' }),
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'string' } }),
    __param(0, (0, common_1.Query)('month')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RewardsAdminController.prototype, "financeCsv", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('rewards/housekeeping/run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 run the expiry and release job once (idempotent; also what the hourly job does)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "runExpiry", null);
__decorate([
    (0, common_1.Get)('credit/lots'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 credit lots (CREDIT mode, refund credit, restored) with the refund-credit liability apart' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "creditLots", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)('credit/goodwill'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 support goodwill (flag growth.support_goodwill, second approver above the threshold)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, GoodwillBody]),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "grantGoodwill", null);
__decorate([
    (0, common_1.Get)('credit/reconcile'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 reconcile runs (RC-1 to RC-7), newest first' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "reconcileRuns", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('credit/reconcile/run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 run the reconciliation now (never corrects, records a case on failure)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RewardsAdminController.prototype, "runReconcile", null);
exports.RewardsAdminController = RewardsAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-credit'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_hold_service_1.RewardHoldService, reward_finance_service_1.RewardFinanceService, goodwill_service_1.GoodwillService, reward_reconcile_job_1.RewardReconcileJob, reward_expiry_job_1.RewardExpiryJob, reward_policy_service_1.RewardPolicyService, reward_reversal_service_1.RewardReversalService])
], RewardsAdminController);
//# sourceMappingURL=rewards-admin.controller.js.map