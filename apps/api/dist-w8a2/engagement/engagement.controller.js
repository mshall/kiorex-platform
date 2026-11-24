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
exports.EngagementController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const engagement_service_1 = require("./engagement.service");
const engagement_dto_1 = require("./engagement.dto");
const dto_1 = require("../common/dto");
class PrefBody {
    enabled;
    quietStart;
    quietEnd;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PrefBody.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(23),
    __metadata("design:type", Number)
], PrefBody.prototype, "quietStart", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(23),
    __metadata("design:type", Number)
], PrefBody.prototype, "quietEnd", void 0);
class DeviceBody {
    platform;
    token;
    appVersion;
    locale;
}
__decorate([
    (0, class_validator_1.IsIn)(engagement_service_1.DEVICE_PLATFORMS),
    __metadata("design:type", String)
], DeviceBody.prototype, "platform", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(16),
    (0, class_validator_1.MaxLength)(4096),
    __metadata("design:type", String)
], DeviceBody.prototype, "token", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], DeviceBody.prototype, "appVersion", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ar', 'en']),
    __metadata("design:type", String)
], DeviceBody.prototype, "locale", void 0);
let EngagementController = class EngagementController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    inbox(u) { return this.svc.inbox(u.sub); }
    read(u, id) { return this.svc.markRead(u.sub, id); }
    prefs(u) { return this.svc.preferences(u.sub); }
    setPref(u, channel, b) {
        if (!engagement_service_1.CHANNELS.includes(channel))
            throw (0, errors_1.badRequest)('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|PUSH|SMS|EMAIL');
        return this.svc.setPreference(u.sub, channel, b);
    }
    registerDevice(u, b) { return this.svc.registerDevice(u.sub, b); }
    listDevices(u) { return this.svc.listDevices(u.sub); }
    removeDevice(u, id) { return this.svc.removeDevice(u.sub, id); }
};
exports.EngagementController = EngagementController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: engagement_dto_1.InboxItemDto, isArray: true }),
    (0, common_1.Get)('notifications'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-NT-01 in-app notification inbox' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "inbox", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    (0, common_1.Post)('notifications/:id/read'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "read", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: engagement_dto_1.NotificationPreferenceDto, isArray: true }),
    (0, common_1.Get)('notification-preferences'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-NT-02 per-channel opt-out and quiet hours' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "prefs", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: engagement_dto_1.NotificationPreferenceDto }),
    (0, common_1.Put)('notification-preferences/:channel'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('channel')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PrefBody]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "setPref", null);
__decorate([
    (0, swagger_1.ApiCreatedResponse)({ type: engagement_dto_1.DeviceDto }),
    (0, common_1.Post)('devices'),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-NT push device registry: register or refresh this app instance\'s push token (idempotent on the token; never echoed back)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, DeviceBody]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "registerDevice", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: engagement_dto_1.DeviceDto, isArray: true }),
    (0, common_1.Get)('devices'),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "listDevices", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    (0, common_1.Delete)('devices/:id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "removeDevice", null);
exports.EngagementController = EngagementController = __decorate([
    (0, swagger_1.ApiTags)('engagement'),
    (0, common_1.Controller)('me'),
    __metadata("design:paramtypes", [engagement_service_1.EngagementService])
], EngagementController);
//# sourceMappingURL=engagement.controller.js.map