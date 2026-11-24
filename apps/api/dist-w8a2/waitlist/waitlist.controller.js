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
exports.WaitlistController = exports.JoinWaitlistBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const dto_1 = require("../common/dto");
const waitlist_dto_1 = require("./waitlist.dto");
const waitlist_service_1 = require("./waitlist.service");
class JoinWaitlistBody {
    providerId;
    typeId;
    preferredFrom;
    preferredTo;
    dependantId;
}
exports.JoinWaitlistBody = JoinWaitlistBody;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JoinWaitlistBody.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JoinWaitlistBody.prototype, "typeId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], JoinWaitlistBody.prototype, "preferredFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], JoinWaitlistBody.prototype, "preferredTo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], JoinWaitlistBody.prototype, "dependantId", void 0);
let WaitlistController = class WaitlistController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    join(u, b) { return this.svc.join(u.sub, b); }
    list(u) { return this.svc.list(u.sub); }
    cancel(u, id) { return this.svc.cancel(u.sub, id); }
    accept(u, id) { return this.svc.accept(u.sub, id); }
    decline(u, id) { return this.svc.decline(u.sub, id); }
    scan() { return this.svc.scan(); }
};
exports.WaitlistController = WaitlistController;
__decorate([
    (0, common_1.Post)('waitlist'),
    (0, common_1.HttpCode)(201),
    (0, control_plane_public_1.RequiresFlag)('kiorex.marketplace'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-12 join a doctor\'s waitlist (idempotent per patient+doctor+visit type). 409 SLOTS_AVAILABLE when the doctor already has open slots in the window: book directly' }),
    (0, swagger_1.ApiCreatedResponse)({ type: waitlist_dto_1.WaitlistEntryDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, JoinWaitlistBody]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "join", null);
__decorate([
    (0, common_1.Get)('waitlist'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-12 my waitlist entries with their offers' }),
    (0, swagger_1.ApiOkResponse)({ type: waitlist_dto_1.WaitlistEntryDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "list", null);
__decorate([
    (0, common_1.Delete)('waitlist/:id'),
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "cancel", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ schema: { $ref: '#/components/schemas/BookingDto' } }),
    (0, common_1.Post)('waitlist/offers/:id/accept'),
    (0, common_1.HttpCode)(200),
    (0, control_plane_public_1.RequiresFlag)('kiorex.marketplace'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-12 accept an offered slot: creates the normal 5-minute hold (returns the booking; then POST /bookings/{id}/confirm). 409 SLOT_TAKEN / 410 OFFER_EXPIRED' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)('waitlist/offers/:id/decline'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "decline", null);
__decorate([
    (0, auth_1.OpsOnly)(),
    (0, common_1.Post)('admin/waitlist/scan'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: run the waitlist autofill scan now' }),
    (0, swagger_1.ApiOkResponse)({ type: waitlist_dto_1.WaitlistScanResultDto }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "scan", null);
exports.WaitlistController = WaitlistController = __decorate([
    (0, swagger_1.ApiTags)('waitlist'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [waitlist_service_1.WaitlistService])
], WaitlistController);
//# sourceMappingURL=waitlist.controller.js.map