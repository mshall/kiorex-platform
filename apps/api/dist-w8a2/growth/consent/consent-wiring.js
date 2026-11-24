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
exports.ConsentWiring = void 0;
const common_1 = require("@nestjs/common");
const outbox_public_1 = require("../../outbox/outbox-public");
const patient_public_1 = require("../../patient/patient-public");
const growth_config_service_1 = require("../config/growth-config.service");
let ConsentWiring = class ConsentWiring {
    prefs;
    config;
    outbox;
    constructor(prefs, config, outbox) {
        this.prefs = prefs;
        this.config = config;
        this.outbox = outbox;
    }
    onModuleInit() {
        this.prefs.setDefaultsProvider(async (market) => (await this.config.resolve('CONSENT_DEFAULTS', { market })).payload);
        this.outbox.register('PatientConsentUpdated', async () => undefined);
    }
};
exports.ConsentWiring = ConsentWiring;
exports.ConsentWiring = ConsentWiring = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PreferenceCentreService))),
    __metadata("design:paramtypes", [patient_public_1.PreferenceCentreService, growth_config_service_1.GrowthConfigService, outbox_public_1.OutboxService])
], ConsentWiring);
//# sourceMappingURL=consent-wiring.js.map