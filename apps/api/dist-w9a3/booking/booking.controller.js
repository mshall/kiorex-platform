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
exports.BookingController = void 0;
exports.growthContextOf = growthContextOf;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const booking_service_1 = require("./booking.service");
const booking_dto_1 = require("./booking.dto");
class CreateBody {
    providerId;
    typeId;
    startsAt;
    endsAt;
    dependantId;
    channel;
    bookingPageSlug;
    serviceLocation;
    addressId;
    lt;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "typeId", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "endsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "dependantId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['MARKETPLACE', 'CLINIC_LINK']),
    __metadata("design:type", String)
], CreateBody.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "bookingPageSlug", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['IN_CLINIC', 'HOME']),
    __metadata("design:type", String)
], CreateBody.prototype, "serviceLocation", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBody.prototype, "addressId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(600),
    __metadata("design:type", String)
], CreateBody.prototype, "lt", void 0);
class ConfirmBody {
    marketplaceConsent;
    remindersConsent;
    notes;
}
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ConfirmBody.prototype, "marketplaceConsent", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ConfirmBody.prototype, "remindersConsent", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], ConfirmBody.prototype, "notes", void 0);
class CancelBody {
    reason;
    refundDestination;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CancelBody.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ORIGINAL', 'CREDIT']),
    __metadata("design:type", String)
], CancelBody.prototype, "refundDestination", void 0);
class DepositCheckoutBody {
    couponCode;
    lotId;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(24),
    __metadata("design:type", String)
], DepositCheckoutBody.prototype, "couponCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^rwl_[a-z0-9]+$/),
    __metadata("design:type", String)
], DepositCheckoutBody.prototype, "lotId", void 0);
class RescheduleBody {
    startsAt;
    endsAt;
}
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], RescheduleBody.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], RescheduleBody.prototype, "endsAt", void 0);
const VISITOR_KEY = /^kxv_[A-Za-z0-9_-]{16,64}$/;
const PLATFORMS = new Set(['web', 'ios', 'android', 'whatsapp', 'widget']);
function growthContextOf(req, platformHeader) {
    const h = (n) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
    const cookie = /(?:^|;\s*)kxv=([^;]+)/.exec(h('cookie') ?? '')?.[1];
    const raw = h('x-kx-visitor') ?? cookie;
    const pf = (platformHeader ?? h('x-kx-platform') ?? '').toLowerCase();
    return { visitorKey: raw && VISITOR_KEY.test(raw) ? raw : null, platform: PLATFORMS.has(pf) ? pf : undefined };
}
let BookingController = class BookingController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    create(u, b, req) { return this.svc.createIntent(u.sub, b, growthContextOf(req)); }
    confirm(u, id, b, req) { return this.svc.confirm(u.sub, id, b, growthContextOf(req)); }
    release(u, id) { return this.svc.release(u.sub, id); }
    cancel(u, id, b) { return this.svc.cancel(u.sub, id, b.reason, b.refundDestination); }
    reschedule(u, id, b) { return this.svc.reschedule(u.sub, id, b); }
    deposit(u, id, b) { return this.svc.depositCheckout(u.sub, id, b ?? {}); }
    list(u, status) { return this.svc.list(u.sub, status); }
    get(u, id) { return this.svc.get(u.sub, id); }
    ics(u, id) { return this.svc.ics(u.sub, id); }
};
exports.BookingController = BookingController;
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: booking_dto_1.BookingDto }),
    (0, swagger_1.ApiHeader)({ name: 'X-KX-Platform', required: false, description: 'web | ios | android | whatsapp | widget (closed set for the growth stream; read from the request headers, optional)' }),
    (0, common_1.Post)('bookings'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-02 create intent and 5-minute hold; 409 SLOT_TAKEN carries alternatives (BK-04). HOME visit types need addressId (KXMHV03); 422 OUT_OF_COVERAGE when the district is not covered' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateBody, Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "create", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, swagger_1.ApiHeader)({ name: 'X-KX-Platform', required: false, description: 'web | ios | android | whatsapp | widget (closed set for the growth stream; read from the request headers, optional)' }),
    (0, common_1.Post)('bookings/:id/confirm'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-03/05/06 idempotent confirm (Kiorly Idempotency-Key = booking id)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ConfirmBody, Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "confirm", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, common_1.Post)('bookings/:id/release'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "release", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, common_1.Post)('bookings/:id/cancel'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-07 cancel (policy enforced by Kiorly)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, CancelBody]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "cancel", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, common_1.Post)('bookings/:id/reschedule'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-07 reschedule' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, RescheduleBody]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "reschedule", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.DepositCheckoutDto }),
    (0, common_1.Post)('bookings/:id/deposit-checkout'),
    (0, common_1.HttpCode)(200),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pay_deposits'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-PAY-01 start hosted deposit checkout (flag kiorex.pay_deposits)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, DepositCheckoutBody]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "deposit", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto, isArray: true }),
    (0, common_1.Get)('bookings'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "list", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: booking_dto_1.BookingDto }),
    (0, common_1.Get)('bookings/:id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "get", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ description: 'iCalendar (text/calendar)', schema: { type: 'string' } }),
    (0, common_1.Get)('bookings/:id/calendar.ics'),
    (0, common_1.Header)('content-type', 'text/calendar; charset=utf-8'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-09 add to calendar' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "ics", null);
exports.BookingController = BookingController = __decorate([
    (0, swagger_1.ApiTags)('booking'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [booking_service_1.BookingService])
], BookingController);
//# sourceMappingURL=booking.controller.js.map