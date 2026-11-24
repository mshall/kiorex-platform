"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeCareModule = void 0;
const common_1 = require("@nestjs/common");
const care_plan_service_1 = require("./care-plan.service");
const family_share_service_1 = require("./family-share.service");
const homecare_controller_1 = require("./homecare.controller");
const safety_service_1 = require("./safety.service");
let HomeCareModule = class HomeCareModule {
};
exports.HomeCareModule = HomeCareModule;
exports.HomeCareModule = HomeCareModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ controllers: [homecare_controller_1.HomeCareController, homecare_controller_1.SafetyConsoleController], providers: [family_share_service_1.FamilyShareService, safety_service_1.SafetyService, care_plan_service_1.CarePlanService], exports: [family_share_service_1.FamilyShareService, safety_service_1.SafetyService, care_plan_service_1.CarePlanService] })
], HomeCareModule);
//# sourceMappingURL=homecare.module.js.map