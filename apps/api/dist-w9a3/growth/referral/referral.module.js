"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferralModule = void 0;
const common_1 = require("@nestjs/common");
const kiorly_public_1 = require("../../kiorly/kiorly-public");
const growth_ports_public_1 = require("../growth-ports-public");
const referral_admin_controller_1 = require("./referral-admin.controller");
const referral_claim_service_1 = require("./referral-claim.service");
const referral_expiry_job_1 = require("./referral-expiry.job");
const referral_fraud_service_1 = require("./referral-fraud.service");
const referral_identity_service_1 = require("./referral-identity.service");
const referral_qualification_service_1 = require("./referral-qualification.service");
const referral_controller_1 = require("./referral.controller");
const referral_service_1 = require("./referral.service");
let ReferralModule = class ReferralModule {
};
exports.ReferralModule = ReferralModule;
exports.ReferralModule = ReferralModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [kiorly_public_1.KiorlyModule],
        controllers: [referral_controller_1.ReferralController, referral_admin_controller_1.ReferralAdminController],
        providers: [
            referral_identity_service_1.ReferralIdentityService, referral_identity_service_1.MockStaffPhoneMatch, referral_identity_service_1.ClinicStaffPhoneMatch, { provide: referral_identity_service_1.STAFF_PHONE_MATCH, useFactory: (m, c) => (process.env.STAFF_PHONE_MATCH_MODE === 'clinic' ? c : m), inject: [referral_identity_service_1.MockStaffPhoneMatch, referral_identity_service_1.ClinicStaffPhoneMatch] }, referral_fraud_service_1.ReferralFraudService, referral_service_1.ReferralService, referral_claim_service_1.ReferralClaimService, referral_qualification_service_1.ReferralQualificationService,
            { provide: growth_ports_public_1.REFERRAL_PORT, useExisting: referral_qualification_service_1.ReferralQualificationService }, referral_expiry_job_1.ReferralExpiryJob,
        ],
        exports: [growth_ports_public_1.REFERRAL_PORT, referral_service_1.ReferralService, referral_claim_service_1.ReferralClaimService, referral_qualification_service_1.ReferralQualificationService, referral_identity_service_1.ReferralIdentityService, referral_expiry_job_1.ReferralExpiryJob, referral_identity_service_1.MockStaffPhoneMatch],
    })
], ReferralModule);
//# sourceMappingURL=referral.module.js.map