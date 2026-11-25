"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingImportModule = void 0;
const common_1 = require("@nestjs/common");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const adapters_1 = require("./adapters");
const file_scan_1 = require("./lib/file-scan");
const onboarding_import_controller_1 = require("./onboarding-import.controller");
const onboarding_import_service_1 = require("./onboarding-import.service");
let OnboardingImportModule = class OnboardingImportModule {
};
exports.OnboardingImportModule = OnboardingImportModule;
exports.OnboardingImportModule = OnboardingImportModule = __decorate([
    (0, common_1.Module)({
        controllers: [onboarding_import_controller_1.OnboardingImportController],
        providers: [
            onboarding_import_service_1.OnboardingImportService, adapters_1.MockImportTarget,
            { provide: adapters_1.STAGING_STORE, useClass: adapters_1.LocalStagingStore },
            { provide: file_scan_1.MALWARE_SCANNER, useClass: file_scan_1.MockMalwareScanner },
            { provide: adapters_1.IMPORT_TARGET, inject: [kiorly_public_1.KiorlyClient, adapters_1.MockImportTarget], useFactory: (k, m) => (process.env.IMPORT_TARGET_MODE === 'kiorly' ? new adapters_1.KiorlyImportTarget(k) : m) },
        ],
    })
], OnboardingImportModule);
//# sourceMappingURL=onboarding-import.module.js.map