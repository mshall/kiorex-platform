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
exports.LabController = exports.LabBookBody = exports.LabAddressBody = exports.LabSlotBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const lab_dto_1 = require("./lab.dto");
const lab_service_1 = require("./lab.service");
const growth_ports_public_1 = require("../growth/growth-ports-public");
class LabSlotBody {
    startsAt;
    endsAt;
}
exports.LabSlotBody = LabSlotBody;
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], LabSlotBody.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], LabSlotBody.prototype, "endsAt", void 0);
class LabAddressBody {
    line1;
    area;
    governorate;
    notes;
    phone;
}
exports.LabAddressBody = LabAddressBody;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], LabAddressBody.prototype, "line1", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], LabAddressBody.prototype, "area", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], LabAddressBody.prototype, "governorate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], LabAddressBody.prototype, "notes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], LabAddressBody.prototype, "phone", void 0);
class LabBookBody {
    labId;
    partnerId;
    testCodes;
    collectionType;
    slot;
    address;
}
exports.LabBookBody = LabBookBody;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LabBookBody.prototype, "labId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], LabBookBody.prototype, "partnerId", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], LabBookBody.prototype, "testCodes", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['HOME', 'WALK_IN']),
    __metadata("design:type", String)
], LabBookBody.prototype, "collectionType", void 0);
__decorate([
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => LabSlotBody),
    __metadata("design:type", LabSlotBody)
], LabBookBody.prototype, "slot", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => LabAddressBody),
    __metadata("design:type", LabAddressBody)
], LabBookBody.prototype, "address", void 0);
let LabController = class LabController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    tests(q, labId, partnerId) { return this.svc.searchTests({ q, labId, partnerId }); }
    slots(labId, collectionType = 'HOME', from, to, tests, partnerId) {
        if (!labId)
            throw (0, errors_1.badRequest)('LAB_REQUIRED', 'labId required');
        const f = from ? new Date(from) : new Date();
        const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
        if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()))
            throw (0, errors_1.badRequest)('INVALID_RANGE', 'invalid from/to');
        return this.svc.slots(labId, collectionType, f, t, tests, partnerId);
    }
    book(u, b, cont) { return this.svc.book(u.sub, b, { continuityId: (0, growth_ports_public_1.continuityIdFrom)(cont) }); }
    list(u) { return this.svc.list(u.sub); }
    get(u, id) { return this.svc.get(u.sub, id); }
    cancel(u, id) { return this.svc.cancel(u.sub, id); }
    opsList(status, partnerId) { return this.svc.opsList(status, partnerId); }
    resubmit(id) { return this.svc.resubmit(id); }
};
exports.LabController = LabController;
__decorate([
    (0, common_1.Get)('lab/tests'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.lab_bookings'),
    (0, swagger_1.ApiOperation)({ summary: 'Lab test catalogue search' }),
    (0, swagger_1.ApiOkResponse)({ type: lab_dto_1.LabTestsResultDto }),
    __param(0, (0, common_1.Query)('q')),
    __param(1, (0, common_1.Query)('labId')),
    __param(2, (0, common_1.Query)('partnerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "tests", null);
__decorate([
    (0, common_1.Get)('lab/slots'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.lab_bookings'),
    (0, swagger_1.ApiOperation)({ summary: 'Collection slots (home collection or walk-in) from the lab' }),
    (0, swagger_1.ApiOkResponse)({ type: lab_dto_1.LabSlotsResultDto }),
    __param(0, (0, common_1.Query)('labId')),
    __param(1, (0, common_1.Query)('collectionType')),
    __param(2, (0, common_1.Query)('from')),
    __param(3, (0, common_1.Query)('to')),
    __param(4, (0, common_1.Query)('tests')),
    __param(5, (0, common_1.Query)('partnerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "slots", null);
__decorate([
    (0, common_1.Post)('lab/bookings'),
    (0, common_1.HttpCode)(201),
    (0, control_plane_public_1.RequiresFlag)('kiorex.lab_bookings'),
    (0, swagger_1.ApiOperation)({ summary: 'Book tests + collection slot; returns the booking with a Kiorex Pay checkout. After payment the order is sent to Kiorly Lab' }),
    (0, swagger_1.ApiCreatedResponse)({ type: lab_dto_1.LabBookingDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)(growth_ports_public_1.CONTINUITY_HEADER)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, LabBookBody, String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "book", null);
__decorate([
    (0, common_1.Get)('lab/bookings'),
    (0, swagger_1.ApiOkResponse)({ type: lab_dto_1.LabBookingDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('lab/bookings/:id'),
    (0, swagger_1.ApiOkResponse)({ type: lab_dto_1.LabBookingDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('lab/bookings/:id/cancel'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOkResponse)({ type: lab_dto_1.LabBookingDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "cancel", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/LabBookingDto' }, { type: 'object', properties: { sub: { type: 'string' }, platformFeeMinor: { type: 'number' }, takeRateBps: { type: 'number' } } }] } } }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/lab/bookings'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: lab bookings (status filter)' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('partnerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "opsList", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'object', properties: { status: { type: 'string', description: 'SUBMITTED | REJECTED | ...' } } } }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Post)('admin/lab/bookings/:id/resubmit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: re-send a PAID booking to Kiorly Lab (idempotent)' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LabController.prototype, "resubmit", null);
exports.LabController = LabController = __decorate([
    (0, swagger_1.ApiTags)('lab'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [lab_service_1.LabService])
], LabController);
//# sourceMappingURL=lab.controller.js.map