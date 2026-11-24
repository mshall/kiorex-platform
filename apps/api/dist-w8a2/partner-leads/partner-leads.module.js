"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerLeadsModule = void 0;
const common_1 = require("@nestjs/common");
const partner_leads_controller_1 = require("./partner-leads.controller");
const lead_alerts_service_1 = require("./lead-alerts.service");
const partner_leads_service_1 = require("./partner-leads.service");
let PartnerLeadsModule = class PartnerLeadsModule {
};
exports.PartnerLeadsModule = PartnerLeadsModule;
exports.PartnerLeadsModule = PartnerLeadsModule = __decorate([
    (0, common_1.Module)({ controllers: [partner_leads_controller_1.PartnerLeadsPublicController, partner_leads_controller_1.PartnerLeadsOpsController], providers: [partner_leads_service_1.PartnerLeadsService, lead_alerts_service_1.LeadAlertsService], exports: [partner_leads_service_1.PartnerLeadsService, lead_alerts_service_1.LeadAlertsService] })
], PartnerLeadsModule);
//# sourceMappingURL=partner-leads.module.js.map