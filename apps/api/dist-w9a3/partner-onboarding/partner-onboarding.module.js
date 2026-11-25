"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerOnboardingModule = void 0;
const common_1 = require("@nestjs/common");
const partner_onboarding_controller_1 = require("./partner-onboarding.controller");
const verification_update_consumer_1 = require("./verification-update.consumer");
const partner_enrolment_service_1 = require("./partner-enrolment.service");
const partner_onboarding_service_1 = require("./partner-onboarding.service");
let PartnerOnboardingModule = class PartnerOnboardingModule {
};
exports.PartnerOnboardingModule = PartnerOnboardingModule;
exports.PartnerOnboardingModule = PartnerOnboardingModule = __decorate([
    (0, common_1.Module)({ controllers: [partner_onboarding_controller_1.PartnerConnectionPublicController, partner_onboarding_controller_1.PartnerEnrolmentController, partner_onboarding_controller_1.PartnerOnboardingController, partner_onboarding_controller_1.VerificationUpdateController], providers: [partner_onboarding_service_1.PartnerOnboardingService, partner_enrolment_service_1.PartnerEnrolmentService, verification_update_consumer_1.VerificationUpdateService], exports: [partner_onboarding_service_1.PartnerOnboardingService, verification_update_consumer_1.VerificationUpdateService] })
], PartnerOnboardingModule);
//# sourceMappingURL=partner-onboarding.module.js.map