"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemedicineModule = void 0;
const common_1 = require("@nestjs/common");
const telemedicine_controller_1 = require("./telemedicine.controller");
const telemedicine_service_1 = require("./telemedicine.service");
const video_1 = require("./video");
let TelemedicineModule = class TelemedicineModule {
};
exports.TelemedicineModule = TelemedicineModule;
exports.TelemedicineModule = TelemedicineModule = __decorate([
    (0, common_1.Module)({ controllers: [telemedicine_controller_1.TelemedicineController], providers: [telemedicine_service_1.TelemedicineService, { provide: video_1.VIDEO, useFactory: video_1.videoAdapter }], exports: [telemedicine_service_1.TelemedicineService] })
], TelemedicineModule);
//# sourceMappingURL=telemedicine.module.js.map