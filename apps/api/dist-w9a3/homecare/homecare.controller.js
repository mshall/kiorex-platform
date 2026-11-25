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
exports.SafetyConsoleController = exports.HomeCareController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const dto_1 = require("../common/dto");
const errors_1 = require("../common/errors");
const booking_public_1 = require("../booking/booking-public");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const trust_public_1 = require("../trust/trust-public");
const care_plan_service_1 = require("./care-plan.service");
const family_share_service_1 = require("./family-share.service");
const safety_service_1 = require("./safety.service");
const homecare_dto_1 = require("./homecare.dto");
const config_1 = require("../common/config");
class FamilyShareBody {
    contactName;
    phone;
    locale;
    consentAttested;
    visitStatusSharingConsent;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], FamilyShareBody.prototype, "contactName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], FamilyShareBody.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ar', 'en']),
    __metadata("design:type", String)
], FamilyShareBody.prototype, "locale", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FamilyShareBody.prototype, "consentAttested", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], FamilyShareBody.prototype, "visitStatusSharingConsent", void 0);
class ProblemBody {
    category;
    body;
}
__decorate([
    (0, class_validator_1.IsIn)(['SAFETY', 'CONDUCT', 'PROVIDER_NO_SHOW', 'BILLING', 'OTHER']),
    __metadata("design:type", String)
], ProblemBody.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], ProblemBody.prototype, "body", void 0);
class CarePlanBody {
    providerId;
    addressId;
    typeId;
    preferredStartDate;
    notes;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CarePlanBody.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CarePlanBody.prototype, "addressId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CarePlanBody.prototype, "typeId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CarePlanBody.prototype, "preferredStartDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], CarePlanBody.prototype, "notes", void 0);
class NoteBody {
    note;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], NoteBody.prototype, "note", void 0);
let HomeCareController = class HomeCareController {
    shares;
    booking;
    trust;
    plans;
    constructor(shares, booking, trust, plans) {
        this.shares = shares;
        this.booking = booking;
        this.trust = trust;
        this.plans = plans;
    }
    addShare(u, id, b) { return this.shares.create(u.sub, id, b); }
    listShares(u, id) { return this.shares.list(u.sub, id); }
    revokeShare(u, id, shareId) { return this.shares.revoke(u.sub, id, shareId); }
    publicStatus(token) { return this.shares.publicStatus(token); }
    stop(token) { return this.shares.stop(token); }
    async safetyCard(u, id) {
        const b = await this.booking.ownedBooking(u.sub, id);
        if (b.serviceLocation !== 'HOME')
            throw (0, errors_1.conflict)('NOT_A_HOME_BOOKING', 'Safety card is for home visits');
        const p = await this.booking.providerOf(b);
        const prog = await this.booking.homeProgress(b, p);
        const raw = p?.raw ?? {};
        const a = prog.assignee;
        return {
            bookingId: b.id,
            provider: { displayName: a?.displayName ?? p?.nameEn ?? null, displayNameAr: a ? null : p?.nameAr ?? null, photoUrl: a?.photoUrl ?? raw.provider?.photoUrl ?? null, badge: a?.badge ?? null, profession: a?.profession ?? p?.profession ?? null, verified: p?.status === 'LIVE', register: p?.verificationRegister ?? null, agency: !!p?.assignsClinician },
            assignmentPending: prog.assignmentPending, emergencyNumber: '123',
            reportProblem: { slaMinutes: Math.round((0, config_1.cfg)().homeComplaintSlaMinutes), endpoint: `/api/v1/bookings/${b.id}/report-problem` },
            familyShare: { max: (0, config_1.cfg)().familyShareMax, active: await this.shares.activeCount(b.id) },
        };
    }
    async report(u, id, b) {
        const bk = await this.booking.ownedBooking(u.sub, id);
        if (bk.serviceLocation !== 'HOME')
            throw (0, errors_1.conflict)('NOT_A_HOME_BOOKING', 'Use /complaints for clinic visits');
        const c = await this.trust.complain(u.sub, { category: `HOME_${b.category}`, body: b.body ?? '', bookingId: id });
        return { id: c.id, category: c.category, slaDueAt: c.slaDueAt, homeVisit: c.homeVisit, status: c.status };
    }
    requestPlan(u, b, cont) { return this.plans.request(u.sub, b, { continuityId: (0, growth_ports_public_1.continuityIdFrom)(cont) }); }
    listPlans(u) { return this.plans.list(u.sub); }
    getPlan(u, id) { return this.plans.get(u.sub, id); }
};
exports.HomeCareController = HomeCareController;
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: homecare_dto_1.FamilyShareCreatedDto }),
    (0, common_1.Post)('bookings/:id/family-shares'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMHV07 share the visit status with a family contact by WhatsApp link (max 3; needs consentAttested + VISIT_STATUS_SHARING consent)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, FamilyShareBody]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "addShare", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.FamilyShareDto, isArray: true }),
    (0, common_1.Get)('bookings/:id/family-shares'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "listShares", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    (0, common_1.Delete)('bookings/:id/family-shares/:shareId'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('shareId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "revokeShare", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.PublicVisitStatusDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('public/visit-status/:token'),
    (0, swagger_1.ApiOperation)({ summary: 'Family link (no login): visit status only. Never address, fee, phone or reasons' }),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "publicStatus", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)('public/visit-status/:token/stop'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Family contact stops the updates (STOP)' }),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "stop", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetyCardDto }),
    (0, common_1.Get)('bookings/:id/safety-card'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMHV09 safety card: provider photo, name and badge before arrival, emergency number, report-a-problem' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], HomeCareController.prototype, "safetyCard", null);
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: homecare_dto_1.ProblemReportDto }),
    (0, common_1.Post)('bookings/:id/report-problem'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMHV09 report a problem during/after a home visit: routes to ops with a 1 h SLA (KXMOP05)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ProblemBody]),
    __metadata("design:returntype", Promise)
], HomeCareController.prototype, "report", null);
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: homecare_dto_1.CarePlanDto }),
    (0, common_1.Post)('care-plans'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMHV08 (P3 draft) request a care plan; 403 FEATURE_DISABLED until nurse.care_plans (GKN1) and kiorex.home_visits are effective' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)(growth_ports_public_1.CONTINUITY_HEADER)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CarePlanBody, String]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "requestPlan", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.CarePlanDto, isArray: true }),
    (0, common_1.Get)('care-plans'),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "listPlans", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.CarePlanDto }),
    (0, common_1.Get)('care-plans/:id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], HomeCareController.prototype, "getPlan", null);
exports.HomeCareController = HomeCareController = __decorate([
    (0, swagger_1.ApiTags)('home-visits'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [family_share_service_1.FamilyShareService, booking_public_1.BookingService, trust_public_1.TrustService, care_plan_service_1.CarePlanService])
], HomeCareController);
let SafetyConsoleController = class SafetyConsoleController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    alerts(status, kind, limit) { return this.svc.list({ status, kind, limit: limit ? Number(limit) : undefined }); }
    summary() { return this.svc.summary(); }
    escalations() { return this.svc.escalationLog(); }
    unsafeAborts() { return this.svc.unsafeAborts(); }
    get(id) { return this.svc.get(id); }
    ack(u, id, b) { return this.svc.acknowledge(u.sub, id, b.note); }
    escalate(u, id, b) { return this.svc.escalate(u.sub, id, b.note); }
    resolve(u, id, b) { return this.svc.resolve(u.sub, id, b.note); }
    sweep() { return this.svc.sweep(); }
};
exports.SafetyConsoleController = SafetyConsoleController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetyAlertListDto }),
    (0, common_1.Get)('alerts'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMOP12 SAFETY_ALERT_RAISED feed with the 60 s delivery SLO fields' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('kind')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "alerts", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetySummaryDto }),
    (0, common_1.Get)('summary'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "summary", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.EscalationLogDto, isArray: true }),
    (0, common_1.Get)('escalations'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "escalations", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.UnsafeAbortDto, isArray: true }),
    (0, common_1.Get)('unsafe-aborts'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "unsafeAborts", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetyAlertDto }),
    (0, common_1.Get)('alerts/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "get", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetyAlertDto }),
    (0, common_1.Post)('alerts/:id/acknowledge'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, NoteBody]),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "ack", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetyAlertDto }),
    (0, common_1.Post)('alerts/:id/escalate'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, NoteBody]),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "escalate", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SafetyAlertDto }),
    (0, common_1.Post)('alerts/:id/resolve'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, NoteBody]),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "resolve", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: homecare_dto_1.SweepSafetyDto }),
    (0, common_1.Post)('sweep'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Retry undelivered alerts and auto-escalate alerts unacknowledged for 10 minutes' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SafetyConsoleController.prototype, "sweep", null);
exports.SafetyConsoleController = SafetyConsoleController = __decorate([
    (0, swagger_1.ApiTags)('ops'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/safety'),
    __metadata("design:paramtypes", [safety_service_1.SafetyService])
], SafetyConsoleController);
//# sourceMappingURL=homecare.controller.js.map