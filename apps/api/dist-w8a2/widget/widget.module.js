"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const embed_controller_1 = require("./embed.controller");
const widget_assets_1 = require("./widget-assets");
const widget_audit_service_1 = require("./widget-audit.service");
const widget_limiter_1 = require("./widget-limiter");
const widget_mounter_1 = require("./widget-mounter");
const widget_policy_service_1 = require("./widget-policy.service");
const widget_registration_service_1 = require("./widget-registration.service");
const widget_guard_1 = require("./widget.guard");
const widget_controller_1 = require("./widget.controller");
let WidgetModule = class WidgetModule {
};
exports.WidgetModule = WidgetModule;
exports.WidgetModule = WidgetModule = __decorate([
    (0, common_1.Module)({
        controllers: [widget_controller_1.WidgetController],
        providers: [widget_limiter_1.WidgetLimiter, widget_audit_service_1.WidgetAuditService, widget_registration_service_1.WidgetRegistrationService, widget_policy_service_1.WidgetPolicyService, widget_assets_1.WidgetAssets, embed_controller_1.EmbedHandlers, widget_mounter_1.WidgetMounter, { provide: core_1.APP_GUARD, useClass: widget_guard_1.WidgetRequestGuard }],
        exports: [widget_registration_service_1.WidgetRegistrationService],
    })
], WidgetModule);
//# sourceMappingURL=widget.module.js.map