"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectDeletedConsumer = void 0;
const common_1 = require("@nestjs/common");
const patient_public_1 = require("../../patient/patient-public");
const growth_maintenance_service_1 = require("../maintenance/growth-maintenance.service");
let SubjectDeletedConsumer = class SubjectDeletedConsumer {
    patients;
    maintenance;
    log = new common_1.Logger('growth-erasure');
    constructor(patients, maintenance) {
        this.patients = patients;
        this.maintenance = maintenance;
    }
    onModuleInit() {
        this.patients.registerAnonymizer('growth', async (sub) => {
            const r = await this.maintenance.eraseSubject(sub);
            this.log.log(`erased growth data: touches deleted ${r.touchpointsDeleted}, anonymised ${r.touchpointsAnonymised}, events ${r.eventsDeleted}`);
            return r;
        });
    }
};
exports.SubjectDeletedConsumer = SubjectDeletedConsumer;
exports.SubjectDeletedConsumer = SubjectDeletedConsumer = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PatientService))),
    __metadata("design:paramtypes", [patient_public_1.PatientService, growth_maintenance_service_1.GrowthMaintenanceService])
], SubjectDeletedConsumer);
//# sourceMappingURL=subject-deleted.consumer.js.map