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
exports.DevPayController = exports.DevPaySimulateResultDto = exports.DevPaymentDto = exports.DevPaySimulateBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const prisma_service_1 = require("../prisma/prisma.service");
const pay_service_1 = require("./pay.service");
const psp_1 = require("./psp");
class DevPaySimulateBody {
    outcome;
    amountMinor;
}
exports.DevPaySimulateBody = DevPaySimulateBody;
__decorate([
    (0, class_validator_1.IsIn)(['captured', 'failed', 'refund_settled']),
    __metadata("design:type", String)
], DevPaySimulateBody.prototype, "outcome", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], DevPaySimulateBody.prototype, "amountMinor", void 0);
class DevPaymentDto {
    id;
    bookingId;
    amountMinor;
    currency;
    status;
    checkoutUrl;
    refundedMinor;
    refunds;
}
exports.DevPaymentDto = DevPaymentDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], DevPaymentDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DevPaymentDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], DevPaymentDto.prototype, "amountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], DevPaymentDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], DevPaymentDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DevPaymentDto.prototype, "checkoutUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], DevPaymentDto.prototype, "refundedMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], description: 'Refund id:status pairs' }),
    __metadata("design:type", Array)
], DevPaymentDto.prototype, "refunds", void 0);
class DevPaySimulateResultDto {
    webhookStatus;
    payment;
}
exports.DevPaySimulateResultDto = DevPaySimulateResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], DevPaySimulateResultDto.prototype, "webhookStatus", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: DevPaymentDto }),
    __metadata("design:type", DevPaymentDto)
], DevPaySimulateResultDto.prototype, "payment", void 0);
let DevPayController = class DevPayController {
    prisma;
    pay;
    constructor(prisma, pay) {
        this.prisma = prisma;
        this.pay = pay;
    }
    guard() { if (!(0, config_1.cfg)().payDevRoutesEnabled)
        throw (0, errors_1.notFound)('NOT_FOUND', 'Not found'); }
    async present(id) {
        const p = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id } });
        const refunds = await this.prisma.refund.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'asc' } });
        return { id: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, checkoutUrl: p.checkoutUrl, refundedMinor: p.refundedMinor, refunds: refunds.map((r) => `${r.id}:${r.status}`) };
    }
    async list() {
        this.guard();
        const rows = await this.prisma.paymentIntent.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true } });
        return Promise.all(rows.map((r) => this.present(r.id)));
    }
    async simulate(id, b) {
        this.guard();
        const p = await this.prisma.paymentIntent.findUnique({ where: { id } });
        if (!p)
            throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
        const refund = b.outcome === 'refund_settled' ? await this.prisma.refund.findFirst({ where: { paymentId: id }, orderBy: { createdAt: 'desc' } }) : null;
        const ev = {
            eventId: (0, ids_1.newId)('pspev'), type: b.outcome === 'captured' ? 'payment.captured' : b.outcome === 'failed' ? 'payment.failed' : 'refund.settled',
            pspRef: refund?.pspRefundRef ?? p.pspRef ?? '', paymentId: p.id, amountMinor: b.amountMinor ?? refund?.amountMinor ?? p.amountMinor,
            feeMinor: b.outcome === 'captured' ? Math.round((p.amountMinor * (0, config_1.cfg)().pspFeeBps) / 10000) : undefined, occurredAt: new Date().toISOString(),
        };
        const raw = JSON.stringify(ev);
        const r = await this.pay.handlePspWebhook(p.psp, raw, { 'x-psp-signature': psp_1.FakePspAdapter.sign(raw) });
        return { webhookStatus: r.status, payment: await this.present(id) };
    }
};
exports.DevPayController = DevPayController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: DevPaymentDto, isArray: true }),
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: latest payment intents with refund state' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DevPayController.prototype, "list", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: DevPaySimulateResultDto }),
    (0, common_1.Post)(':id/simulate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: simulate a signed PSP webhook (captured | failed | refund_settled) for a payment' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, DevPaySimulateBody]),
    __metadata("design:returntype", Promise)
], DevPayController.prototype, "simulate", null);
exports.DevPayController = DevPayController = __decorate([
    (0, swagger_1.ApiTags)('dev'),
    (0, auth_1.Public)(),
    (0, common_1.Controller)('dev/payments'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, pay_service_1.PayService])
], DevPayController);
//# sourceMappingURL=dev-pay.controller.js.map