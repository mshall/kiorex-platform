"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketModule = void 0;
const common_1 = require("@nestjs/common");
const app_links_controller_1 = require("./app-links.controller");
const bootstrap_controller_1 = require("./bootstrap.controller");
const bootstrap_service_1 = require("./bootstrap.service");
const link_landing_controller_1 = require("./link-landing.controller");
const market_controller_1 = require("./market.controller");
const market_service_1 = require("./market.service");
const market_profile_service_1 = require("./market-profile.service");
let MarketModule = class MarketModule {
};
exports.MarketModule = MarketModule;
exports.MarketModule = MarketModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ controllers: [market_controller_1.MarketController, bootstrap_controller_1.BootstrapController, app_links_controller_1.AppLinksController, link_landing_controller_1.LinkLandingController], providers: [market_service_1.MarketService, bootstrap_service_1.BootstrapService, market_profile_service_1.MarketProfileService], exports: [market_service_1.MarketService, market_profile_service_1.MarketProfileService] })
], MarketModule);
//# sourceMappingURL=market.module.js.map