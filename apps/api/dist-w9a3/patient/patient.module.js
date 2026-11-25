"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatientModule = void 0;
const common_1 = require("@nestjs/common");
const patient_controller_1 = require("./patient.controller");
const patient_service_1 = require("./patient.service");
const consent_service_1 = require("./consent/consent.service");
const preference_centre_service_1 = require("./consent/preference-centre.service");
const suppression_service_1 = require("./consent/suppression.service");
const preference_centre_controller_1 = require("./consent/preference-centre.controller");
let PatientModule = class PatientModule {
};
exports.PatientModule = PatientModule;
exports.PatientModule = PatientModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ controllers: [patient_controller_1.PatientController, preference_centre_controller_1.PreferenceCentreController], providers: [patient_service_1.PatientService, consent_service_1.ConsentService, preference_centre_service_1.PreferenceCentreService, suppression_service_1.SuppressionService], exports: [patient_service_1.PatientService, consent_service_1.ConsentService, preference_centre_service_1.PreferenceCentreService, suppression_service_1.SuppressionService] })
], PatientModule);
//# sourceMappingURL=patient.module.js.map