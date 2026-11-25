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
exports.CrossProductErasure = exports.CrossProductJob = exports.CrossProductConsumer = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const patient_public_1 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_failures_1 = require("../growth-failures");
const continuity_service_1 = require("./continuity.service");
const str = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);
let CrossProductConsumer = class CrossProductConsumer {
    prisma;
    cross;
    log = new common_1.Logger('cross-product');
    constructor(prisma, cross) {
        this.prisma = prisma;
        this.cross = cross;
    }
    async onKiorlyEvent(env) {
        try {
            if (!(await this.cross.isOn()))
                return { offered: 0 };
            if (env.type === 'PRESCRIPTION_SHARED')
                return await this.onPrescription(env.data ?? {});
            if (env.type === 'LabOrderPlaced')
                return await this.onLabOrder(env.data ?? {});
            return { offered: 0 };
        }
        catch (e) {
            (0, growth_failures_1.recordGrowthFailure)(continuity_service_1.CROSS_PRODUCT_FAILURE.ENTRY);
            this.log.warn(`${continuity_service_1.CROSS_PRODUCT_FAILURE.ENTRY} ${env.type}: ${e.message}`);
            return { offered: 0 };
        }
    }
    subsOf(kiorlyPatientId) { return this.prisma.kiorlyPatientLink.findMany({ where: { kiorlyPatientId, status: 'LINKED', dependantId: null }, select: { sub: true } }); }
    async onPrescription(d) {
        const patientId = str(d.patientId);
        const encounterId = str(d.encounterId);
        const clinicId = str(d.clinicId);
        if (!patientId || !encounterId)
            return { offered: 0 };
        const signedAt = typeof d.signedAt === 'string' && !Number.isNaN(Date.parse(d.signedAt)) ? new Date(d.signedAt) : new Date();
        let offered = 0;
        for (const l of await this.subsOf(patientId)) {
            const rec = await this.prisma.sharedRecord.findFirst({ where: { sub: l.sub, kind: 'PRESCRIPTION', sourceRef: encounterId, status: 'ACTIVE' }, select: { id: true } });
            if (!rec)
                continue;
            if (await this.cross.offer({ sub: l.sub, kind: 'RX_TO_PHARMACY', fact: encounterId, factKind: 'RX', at: signedAt, clinicId }))
                offered += 1;
        }
        return { offered };
    }
    async onLabOrder(d) {
        if (d.originEdition === 'NURSE')
            return { offered: 0 };
        const patientRef = str(d.patientRef);
        const orderId = str(d.orderId);
        const clinicId = str(d.clinicId);
        if (!patientRef || !orderId)
            return { offered: 0 };
        const orderedAt = typeof d.orderedAt === 'string' && !Number.isNaN(Date.parse(d.orderedAt)) ? new Date(d.orderedAt) : new Date();
        let offered = 0;
        for (const l of await this.subsOf(patientRef))
            if (await this.cross.offer({ sub: l.sub, kind: 'LAB_ORDER_TO_LAB', fact: orderId, factKind: 'LAB_ORDER', at: orderedAt, clinicId }))
                offered += 1;
        return { offered };
    }
};
exports.CrossProductConsumer = CrossProductConsumer;
exports.CrossProductConsumer = CrossProductConsumer = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, continuity_service_1.CrossProductService])
], CrossProductConsumer);
let CrossProductJob = class CrossProductJob {
    cross;
    log = new common_1.Logger('cross-product-job');
    timer;
    constructor(cross) {
        this.cross = cross;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.cross.purgeExpired().catch((e) => this.log.warn(`cross-product purge failed: ${e.message}`)), 24 * 3_600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
};
exports.CrossProductJob = CrossProductJob;
exports.CrossProductJob = CrossProductJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [continuity_service_1.CrossProductService])
], CrossProductJob);
let CrossProductErasure = class CrossProductErasure {
    patients;
    cross;
    constructor(patients, cross) {
        this.patients = patients;
        this.cross = cross;
    }
    onModuleInit() {
        this.patients.registerAnonymizer('crossProduct', (sub) => this.cross.eraseSubject(sub));
        this.patients.registerExport('crossProduct', (sub) => this.cross.exportFor(sub));
    }
};
exports.CrossProductErasure = CrossProductErasure;
exports.CrossProductErasure = CrossProductErasure = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PatientService))),
    __metadata("design:paramtypes", [patient_public_1.PatientService, continuity_service_1.CrossProductService])
], CrossProductErasure);
//# sourceMappingURL=continuity.consumer.js.map