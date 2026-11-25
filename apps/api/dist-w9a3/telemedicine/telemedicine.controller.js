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
exports.TelemedicineController = exports.JoinResultDto = exports.CreateSessionBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const tele_dto_1 = require("./tele.dto");
const telemedicine_service_1 = require("./telemedicine.service");
class CreateSessionBody {
    bookingId;
}
exports.CreateSessionBody = CreateSessionBody;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Your CONFIRMED booking id (kx_bk_...) with a video-capable doctor' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateSessionBody.prototype, "bookingId", void 0);
class JoinResultDto {
    session;
    video;
}
exports.JoinResultDto = JoinResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: tele_dto_1.TeleSessionDto }),
    __metadata("design:type", tele_dto_1.TeleSessionDto)
], JoinResultDto.prototype, "session", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: tele_dto_1.VideoTokenDto }),
    __metadata("design:type", tele_dto_1.VideoTokenDto)
], JoinResultDto.prototype, "video", void 0);
let TelemedicineController = class TelemedicineController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    providers(specialty, q) { return this.svc.match({ specialty, q }); }
    create(u, b) { return this.svc.create(u.sub, b.bookingId); }
    visits(u) { return this.svc.visits(u.sub); }
    list(u) { return this.svc.list(u.sub); }
    get(u, id) { return this.svc.get(u.sub, id); }
    join(u, id) { return this.svc.patientJoin(u.sub, id); }
    end(u, id) { return this.svc.patientEnd(u.sub, id); }
    clinicianToken(req, bookingId) { this.onlyClinic(req); return this.svc.clinicianJoin(bookingId); }
    clinicianEnd(req, bookingId) { this.onlyClinic(req); return this.svc.clinicianEnd(bookingId); }
    onlyClinic(req) { if (req.product !== 'kiorly-clinic')
        throw (0, errors_1.forbidden)('PRODUCT_NOT_ALLOWED', 'Only Kiorly Clinic may use clinician endpoints'); }
};
exports.TelemedicineController = TelemedicineController;
__decorate([
    (0, common_1.Get)('telemedicine/providers'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.telemedicine'),
    (0, swagger_1.ApiOperation)({ summary: 'Matching: video-capable doctors for a specialty/keyword (emergency language returns 123 guidance, no results)' }),
    (0, swagger_1.ApiOkResponse)({ type: tele_dto_1.TeleProvidersResultDto }),
    __param(0, (0, common_1.Query)('specialty')),
    __param(1, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "providers", null);
__decorate([
    (0, common_1.Post)('telemedicine/sessions'),
    (0, common_1.HttpCode)(201),
    (0, control_plane_public_1.RequiresFlag)('kiorex.telemedicine'),
    (0, swagger_1.ApiOperation)({ summary: 'DEV/mock only: create a Kiorex-owned mock video session for your confirmed booking (409 CLINIC_OWNS_CALL when VIDEO_MODE=clinic-p2p)' }),
    (0, swagger_1.ApiCreatedResponse)({ type: tele_dto_1.TeleSessionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateSessionBody]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('telemedicine/visits'),
    (0, swagger_1.ApiOperation)({ summary: 'Your Clinic-owned video visits (VIDEO_MODE=clinic-p2p): session id, state, join window and the patient join URL' }),
    (0, swagger_1.ApiOkResponse)({ type: tele_dto_1.TeleVisitDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "visits", null);
__decorate([
    (0, common_1.Get)('telemedicine/sessions'),
    (0, swagger_1.ApiOkResponse)({ type: tele_dto_1.TeleSessionDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('telemedicine/sessions/:id'),
    (0, swagger_1.ApiOkResponse)({ type: tele_dto_1.TeleSessionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('telemedicine/sessions/:id/join'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Join: issues a room token (MOCK video provider: fake token). Room opens 15 min before the visit' }),
    (0, swagger_1.ApiOkResponse)({ type: JoinResultDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "join", null);
__decorate([
    (0, common_1.Post)('telemedicine/sessions/:id/end'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOkResponse)({ type: tele_dto_1.TeleSessionDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "end", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.UseGuards)(control_plane_public_1.ProductKeyGuard),
    (0, common_1.Post)('telemedicine/clinician/bookings/:bookingId/token'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Kiorly Clinic (product-key HMAC): clinician room token for a Kiorex booking id' }),
    (0, swagger_1.ApiOkResponse)({ type: JoinResultDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('bookingId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "clinicianToken", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.UseGuards)(control_plane_public_1.ProductKeyGuard),
    (0, common_1.Post)('telemedicine/clinician/bookings/:bookingId/end'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Kiorly Clinic (product-key HMAC): end the session' }),
    (0, swagger_1.ApiOkResponse)({ type: tele_dto_1.TeleSessionDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('bookingId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TelemedicineController.prototype, "clinicianEnd", null);
exports.TelemedicineController = TelemedicineController = __decorate([
    (0, swagger_1.ApiTags)('telemedicine'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [telemedicine_service_1.TelemedicineService])
], TelemedicineController);
//# sourceMappingURL=telemedicine.controller.js.map