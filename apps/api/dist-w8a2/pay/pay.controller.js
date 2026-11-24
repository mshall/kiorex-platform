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
exports.PayController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const config_1 = require("../common/config");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const pay_service_1 = require("./pay.service");
const pay_dto_1 = require("./pay.dto");
class PayLinkBody {
    token;
    clinicId;
    amountMinor;
    currency;
    externalRef;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PayLinkBody.prototype, "token", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PayLinkBody.prototype, "clinicId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(2_147_483_647),
    __metadata("design:type", Number)
], PayLinkBody.prototype, "amountMinor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PayLinkBody.prototype, "currency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PayLinkBody.prototype, "externalRef", void 0);
let PayController = class PayController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async intent(u, id) {
        const p = await this.svc.getIntent(id);
        if (p.sub !== u.sub)
            throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
        return { id: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, checkoutUrl: p.checkoutUrl, refundedMinor: p.refundedMinor };
    }
    webhook(psp, req) {
        return this.svc.handlePspWebhook(psp, (req.rawBody ?? Buffer.from(JSON.stringify(req.body))).toString('utf8'), req.headers, req.query ?? {});
    }
    async createLink(req, b) {
        if (req.product !== 'kiorly-clinic')
            throw (0, errors_1.forbidden)('PRODUCT_NOT_ALLOWED', 'Only Kiorly Clinic may register pay links');
        return this.svc.createPayLink(b);
    }
    link(token) { return this.svc.payLink(token); }
    async linkCheckout(token) {
        const p = await this.svc.payLinkCheckout(token);
        return { paymentId: p.id, checkoutUrl: p.checkoutUrl, status: p.status };
    }
    async fakePage(id, returnUrl) {
        if (!(0, config_1.cfg)().sandboxPaymentsAllowed)
            throw (0, errors_1.notFound)('NOT_FOUND', 'Not found');
        const p = await this.svc.getIntent(id);
        const ret = safeReturnUrl(returnUrl);
        return `<!doctype html><meta charset="utf-8"><title>Kiorex Pay sandbox</title><body style="font-family:sans-serif;max-width:420px;margin:48px auto"><h2>Kiorex Pay (sandbox)</h2><p>Amount: ${(p.amountMinor / 100).toFixed(2)} ${p.currency}</p><p>Status: ${p.status}</p><form method="post" action="/api/v1/pay/fake-checkout/${p.id}/complete">${ret ? `<input type="hidden" name="returnUrl" value="${escAttr(ret)}">` : ''}<button name="outcome" value="pay">Pay</button> <button name="outcome" value="fail">Fail</button></form></body>`;
    }
    async fakeComplete(id, outcome, bodyReturn, queryReturn, res) {
        const ack = await this.svc.fakeComplete(id, outcome === 'fail' ? 'fail' : 'pay');
        const ret = safeReturnUrl(bodyReturn ?? queryReturn);
        if (!ret)
            return ack;
        const u = new URL(ret);
        u.searchParams.set('paymentId', id);
        u.searchParams.set('status', outcome === 'fail' ? 'FAILED' : 'CAPTURED');
        res.status(303).setHeader('location', u.toString());
        return ack;
    }
};
exports.PayController = PayController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: pay_dto_1.PayIntentDto }),
    (0, common_1.Get)('intents/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Own payment status' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PayController.prototype, "intent", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: pay_dto_1.PspWebhookAckDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)('webhooks/:psp'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Param)('psp')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PayController.prototype, "webhook", null);
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: pay_dto_1.PayLinkDto }),
    (0, auth_1.Public)(),
    (0, common_1.UseGuards)(control_plane_public_1.ProductKeyGuard),
    (0, common_1.Post)('links'),
    (0, swagger_1.ApiOperation)({ summary: 'Kiorly registers a deposit pay link (product-key HMAC)' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, PayLinkBody]),
    __metadata("design:returntype", Promise)
], PayController.prototype, "createLink", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: pay_dto_1.PayLinkDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('links/:token'),
    (0, swagger_1.ApiOperation)({ summary: 'Hosted pay link info' }),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PayController.prototype, "link", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: pay_dto_1.PayLinkCheckoutDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)('links/:token/checkout'),
    (0, common_1.HttpCode)(200),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pay_deposits'),
    (0, swagger_1.ApiOperation)({ summary: 'Start hosted checkout for a pay link' }),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PayController.prototype, "linkCheckout", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ description: 'Sandbox hosted checkout page (HTML)', schema: { type: 'string' } }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('fake-checkout/:id'),
    (0, common_1.Header)('content-type', 'text/html; charset=utf-8'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('returnUrl')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], PayController.prototype, "fakePage", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: pay_dto_1.PspWebhookAckDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)('fake-checkout/:id/complete'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiQuery)({ name: 'returnUrl', required: false, description: 'DEV/SANDBOX ONLY: redirect (303) here after completing, with paymentId and status appended; must be an allow-listed host (PAY_RETURN_URL_HOSTS, default localhost/127.0.0.1). Without it the JSON ack is returned.' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('outcome')),
    __param(2, (0, common_1.Body)('returnUrl')),
    __param(3, (0, common_1.Query)('returnUrl')),
    __param(4, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PayController.prototype, "fakeComplete", null);
exports.PayController = PayController = __decorate([
    (0, swagger_1.ApiTags)('pay'),
    (0, common_1.Controller)('pay'),
    __metadata("design:paramtypes", [pay_service_1.PayService])
], PayController);
const escAttr = (v) => v.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
function safeReturnUrl(raw) {
    if (!raw || (0, config_1.cfg)().isProd)
        return undefined;
    try {
        const u = new URL(raw);
        const hosts = (process.env.PAY_RETURN_URL_HOSTS ?? 'localhost,127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
        return (u.protocol === 'http:' || u.protocol === 'https:') && hosts.includes(u.hostname) ? u.toString() : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=pay.controller.js.map