"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketOnboardingModule = void 0;
const common_1 = require("@nestjs/common");
const market_onboarding_controller_1 = require("./market-onboarding.controller");
const market_onboarding_service_1 = require("./market-onboarding.service");
let MarketOnboardingModule = class MarketOnboardingModule {
};
exports.MarketOnboardingModule = MarketOnboardingModule;
exports.MarketOnboardingModule = MarketOnboardingModule = __decorate([
    (0, common_1.Module)({ controllers: [market_onboarding_controller_1.MarketOnboardingController], providers: [market_onboarding_service_1.MarketOnboardingService], exports: [market_onboarding_service_1.MarketOnboardingService] })
], MarketOnboardingModule);
//# sourceMappingURL=market-onboarding.module.js.map