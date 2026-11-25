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
exports.PreferenceCentreController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const preference_centre_service_1 = require("./preference-centre.service");
class QuietHoursBody {
    start;
    end;
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(23),
    __metadata("design:type", Number)
], QuietHoursBody.prototype, "start", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(23),
    __metadata("design:type", Number)
], QuietHoursBody.prototype, "end", void 0);
class ChannelBody {
    channel;
    enabled;
}
__decorate([
    (0, class_validator_1.IsIn)([...preference_centre_service_1.MARKETING_CHANNELS]),
    __metadata("design:type", String)
], ChannelBody.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ChannelBody.prototype, "enabled", void 0);
class PreferencesBody {
    analytics;
    reminders;
    marketing;
    channels;
    quietHours;
    source;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PreferencesBody.prototype, "analytics", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PreferencesBody.prototype, "reminders", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], PreferencesBody.prototype, "marketing", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ChannelBody),
    __metadata("design:type", Array)
], PreferencesBody.prototype, "channels", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => QuietHoursBody),
    __metadata("design:type", Object)
], PreferencesBody.prototype, "quietHours", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['web', 'app']),
    __metadata("design:type", String)
], PreferencesBody.prototype, "source", void 0);
const OBJ = { schema: { type: 'object', additionalProperties: true } };
let PreferenceCentreController = class PreferenceCentreController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    get(u) { return this.svc.get(u.sub); }
    put(u, b, req) {
        const { source, ...rest } = b;
        return this.svc.update(u.sub, rest, { source: source ?? 'web', ip: req.ip });
    }
    unsubscribe(u, req) { return this.svc.update(u.sub, { marketingAll: false }, { source: 'web', ip: req.ip }); }
};
exports.PreferenceCentreController = PreferenceCentreController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-I preference centre: service messages, reminders, analytics, per-channel marketing consent, quiet hours, caps' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PreferenceCentreController.prototype, "get", null);
__decorate([
    (0, common_1.Put)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-I change preferences; every consent change is an append-only audit row and a PatientConsentUpdated event' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, PreferencesBody, Object]),
    __metadata("design:returntype", void 0)
], PreferenceCentreController.prototype, "put", null);
__decorate([
    (0, common_1.Post)('unsubscribe-marketing'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-I one-step opt-out of every marketing channel' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PreferenceCentreController.prototype, "unsubscribe", null);
exports.PreferenceCentreController = PreferenceCentreController = __decorate([
    (0, swagger_1.ApiTags)('consent'),
    (0, common_1.Controller)('me/preferences'),
    __metadata("design:paramtypes", [preference_centre_service_1.PreferenceCentreService])
], PreferenceCentreController);
//# sourceMappingURL=preference-centre.controller.js.map