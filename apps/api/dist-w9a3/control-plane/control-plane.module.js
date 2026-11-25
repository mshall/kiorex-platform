"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlPlaneModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const control_plane_controller_1 = require("./control-plane.controller");
const flag_guard_1 = require("./flag.guard");
const flags_service_1 = require("./flags.service");
const product_key_guard_1 = require("./product-key.guard");
let ControlPlaneModule = class ControlPlaneModule {
};
exports.ControlPlaneModule = ControlPlaneModule;
exports.ControlPlaneModule = ControlPlaneModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ controllers: [control_plane_controller_1.ControlPlaneController], providers: [flags_service_1.FlagsService, product_key_guard_1.ProductKeyGuard, { provide: core_1.APP_GUARD, useClass: flag_guard_1.FlagGuard }], exports: [flags_service_1.FlagsService] })
], ControlPlaneModule);
//# sourceMappingURL=control-plane.module.js.map