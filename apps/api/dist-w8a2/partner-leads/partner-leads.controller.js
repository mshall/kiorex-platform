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
exports.PartnerLeadsOpsController = exports.PartnerLeadsPublicController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_validator_2 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const lead_alerts_service_1 = require("./lead-alerts.service");
const partner_leads_service_1 = require("./partner-leads.service");
const MAX_BODY = 4096;
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
class LeadPatchBody {
    status;
    assignee;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], LeadPatchBody.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", Object)
], LeadPatchBody.prototype, "assignee", void 0);
class AlertConfigBody {
    enabled;
    channels;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_2.IsBoolean)(),
    __metadata("design:type", Boolean)
], AlertConfigBody.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_2.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], AlertConfigBody.prototype, "channels", void 0);
class AlertRecipientBody {
    leadAlerts;
    channels;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_2.IsBoolean)(),
    __metadata("design:type", Boolean)
], AlertRecipientBody.prototype, "leadAlerts", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_2.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], AlertRecipientBody.prototype, "channels", void 0);
class LeadNoteBody {
    text;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], LeadNoteBody.prototype, "text", void 0);
let PartnerLeadsPublicController = class PartnerLeadsPublicController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    raw(req) {
        if (!req.rawBody)
            throw new errors_1.ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
        if (req.rawBody.length > MAX_BODY)
            throw new errors_1.ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
        return req.rawBody.toString('utf8');
    }
    lead(req, sig, ts) { return this.svc.submitLead(this.raw(req), { signature: sig, timestamp: ts, ip: req.ip }); }
    funnel(req, sig, ts) { return this.svc.markFunnel(this.raw(req), { signature: sig, timestamp: ts, ip: req.ip }); }
};
exports.PartnerLeadsPublicController = PartnerLeadsPublicController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('leads'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiOperation)({ summary: 'Submit a "Talk to us" lead (HMAC-signed with ts.rawBody; idempotent per (kind, orgRef))' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('x-kiorly-signature')),
    __param(2, (0, common_1.Headers)('x-kiorly-timestamp')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PartnerLeadsPublicController.prototype, "lead", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('funnel'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOkResponse)(OBJ),
    (0, swagger_1.ApiOperation)({ summary: 'Record a privacy-safe funnel marker (kind + org id + stage), signed like a lead' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('x-kiorly-signature')),
    __param(2, (0, common_1.Headers)('x-kiorly-timestamp')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PartnerLeadsPublicController.prototype, "funnel", null);
exports.PartnerLeadsPublicController = PartnerLeadsPublicController = __decorate([
    (0, swagger_1.ApiTags)('partner-leads'),
    (0, common_1.Controller)('partners/v1'),
    __metadata("design:paramtypes", [partner_leads_service_1.PartnerLeadsService])
], PartnerLeadsPublicController);
let PartnerLeadsOpsController = class PartnerLeadsOpsController {
    svc;
    alerts;
    constructor(svc, alerts) {
        this.svc = svc;
        this.alerts = alerts;
    }
    async list(u, status, kind) { await this.alerts.touch(u).catch(() => undefined); return this.svc.list({ status, kind }); }
    funnel(days, kind) { return this.svc.funnel(Number(days ?? 30), kind); }
    async unread(u) { await this.alerts.touch(u).catch(() => undefined); return this.alerts.unread(u.sub); }
    seen(u) { return this.alerts.markSeen(u); }
    async alertSettings(u) { await this.alerts.touch(u, true).catch(() => undefined); return this.alerts.settings(); }
    setAlerts(u, b) { if (!u.roles.includes('super_admin'))
        throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] }); return this.alerts.setConfig(u.sub, b); }
    setRecipient(u, sub, b) { if (u.sub !== sub && !u.roles.includes('super_admin'))
        throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] }); return this.alerts.setRecipient(u.sub, sub, b); }
    patch(u, id, b) { return this.svc.update(u.sub, id, b); }
    note(u, id, b) { return this.svc.addNote(u.sub, id, b.text); }
};
exports.PartnerLeadsOpsController = PartnerLeadsOpsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'OP: partner leads (newest first), status derived from the onboarding request' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], PartnerLeadsOpsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('funnel'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: interested -> started -> submitted -> live (distinct organisations) with conversion' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('days')),
    __param(1, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PartnerLeadsOpsController.prototype, "funnel", null);
__decorate([
    (0, common_1.Get)('unread'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: new leads this team member has not seen yet (nav badge)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PartnerLeadsOpsController.prototype, "unread", null);
__decorate([
    (0, common_1.Post)('seen'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: mark all current leads as seen (clears the badge)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PartnerLeadsOpsController.prototype, "seen", null);
__decorate([
    (0, common_1.Get)('alerts'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: lead alert settings (switch, channels) and the team members who get them' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PartnerLeadsOpsController.prototype, "alertSettings", null);
__decorate([
    (0, common_1.Patch)('alerts'),
    (0, swagger_1.ApiOperation)({ summary: 'OP (super admin): switch lead alerts on/off and choose the channels' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, AlertConfigBody]),
    __metadata("design:returntype", void 0)
], PartnerLeadsOpsController.prototype, "setAlerts", null);
__decorate([
    (0, common_1.Patch)('alerts/recipients/:sub'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: a team member opts in/out of lead alerts and picks their channels (own row; super admin any row)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('sub')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, AlertRecipientBody]),
    __metadata("design:returntype", void 0)
], PartnerLeadsOpsController.prototype, "setRecipient", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: set the lead status and/or assignee' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, LeadPatchBody]),
    __metadata("design:returntype", void 0)
], PartnerLeadsOpsController.prototype, "patch", null);
__decorate([
    (0, common_1.Post)(':id/notes'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: add a note to the lead' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, LeadNoteBody]),
    __metadata("design:returntype", void 0)
], PartnerLeadsOpsController.prototype, "note", null);
exports.PartnerLeadsOpsController = PartnerLeadsOpsController = __decorate([
    (0, swagger_1.ApiTags)('ops-onboarding'),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Controller)('admin/partner-leads'),
    __metadata("design:paramtypes", [partner_leads_service_1.PartnerLeadsService, lead_alerts_service_1.LeadAlertsService])
], PartnerLeadsOpsController);
//# sourceMappingURL=partner-leads.controller.js.map