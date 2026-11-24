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
exports.LifecyclePreferencesController = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const patient_public_1 = require("../../patient/patient-public");
const lifecycle_policy_service_1 = require("./lifecycle-policy.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
let LifecyclePreferencesController = class LifecyclePreferencesController {
    prefs;
    policies;
    constructor(prefs, policies) {
        this.prefs = prefs;
        this.policies = policies;
    }
    async get(u) {
        const p = await this.prefs.get(u.sub);
        const policy = await this.policies.resolve(market_core_public_1.DEFAULT_MARKET);
        const marketing = p.marketing;
        return {
            classes: [
                { class: 'TRANSACTIONAL', required: true, switchable: false, descriptionKey: 'lifecycle.class.transactional' },
                { class: 'SECURITY', required: true, switchable: false, descriptionKey: 'lifecycle.class.security' },
                { class: 'CLINICAL', required: true, switchable: false, descriptionKey: 'lifecycle.class.clinical' },
                { class: 'MARKETING', required: false, switchable: true, available: marketing.available, active: marketing.anyConsent, channels: marketing.channels.map((c) => ({ channel: c.channel, consent: c.marketingConsent, suppressed: c.suppressed })), descriptionKey: 'lifecycle.class.marketing' },
            ],
            reminders: p.reminders,
            quietHours: p.quietHours,
            caps: { perDay: Math.min(policy.caps.perDay, p.caps.perDay), perWeek: Math.min(policy.caps.perWeek, p.caps.perWeek) },
            stopAllMarketing: { method: 'POST', path: '/me/preferences/unsubscribe-marketing' },
        };
    }
};
exports.LifecyclePreferencesController = LifecyclePreferencesController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-E the four message classes, what is required and what is optional, quiet hours and caps' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], LifecyclePreferencesController.prototype, "get", null);
exports.LifecyclePreferencesController = LifecyclePreferencesController = __decorate([
    (0, swagger_1.ApiTags)('consent'),
    (0, common_1.Controller)('me/preferences/classes'),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PreferenceCentreService))),
    __metadata("design:paramtypes", [patient_public_1.PreferenceCentreService, lifecycle_policy_service_1.LifecyclePolicyService])
], LifecyclePreferencesController);
//# sourceMappingURL=lifecycle-preferences.controller.js.map