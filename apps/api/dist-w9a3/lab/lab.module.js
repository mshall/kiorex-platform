"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LabModule = void 0;
const common_1 = require("@nestjs/common");
const lab_client_1 = require("./lab.client");
const lab_controller_1 = require("./lab.controller");
const lab_service_1 = require("./lab.service");
const nurse_lab_client_1 = require("./nurse-lab.client");
const nurse_lab_relay_service_1 = require("./nurse-lab-relay.service");
let LabModule = class LabModule {
};
exports.LabModule = LabModule;
exports.LabModule = LabModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ controllers: [lab_controller_1.LabController], providers: [lab_client_1.LabClient, lab_service_1.LabService, nurse_lab_client_1.NurseLabClient, nurse_lab_relay_service_1.NurseLabRelayService], exports: [lab_service_1.LabService, nurse_lab_relay_service_1.NurseLabRelayService] })
], LabModule);
//# sourceMappingURL=lab.module.js.map