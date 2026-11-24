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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthMaintenanceService = void 0;
const common_1 = require("@nestjs/common");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_defaults_1 = require("../config/growth-defaults");
let GrowthMaintenanceService = class GrowthMaintenanceService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async eraseSubject(sub) {
        const rows = await this.prisma.$queryRaw `SELECT growth_erase_subject(${sub}) AS r`;
        const more = await this.prisma.$queryRaw `SELECT growth_erase_rewards_engine(${sub}) AS r`;
        const registered = await this.prisma.growthEvent.deleteMany({ where: { dedupeKey: `fact|PatientRegistered|${(0, privacy_hash_1.subRefOf)(sub)}` } });
        const exp = await this.prisma.$queryRaw `SELECT growth_erase_experiments(${sub}) AS r`;
        const r = { ...rows[0].r, ...more[0].r, ...exp[0].r };
        return { ...r, eventsDeleted: Number(r.eventsDeleted) + registered.count };
    }
    async purgeExpired(opts = {}) {
        const now = opts.now ?? new Date();
        const rows = await this.prisma.$queryRaw `SELECT growth_purge_expired_v2(${now}::timestamptz, ${opts.linkedMonths ?? growth_defaults_1.DEFAULT_RETENTION.linkedMonths}::int, ${opts.unlinkedMonths ?? growth_defaults_1.DEFAULT_RETENTION.unlinkedMonths}::int) AS r`;
        const exp = await this.prisma.$queryRaw `SELECT growth_purge_experiments(${now}::timestamptz, ${opts.unlinkedMonths ?? growth_defaults_1.DEFAULT_RETENTION.unlinkedMonths}::int) AS r`;
        return { ...rows[0].r, ...exp[0].r };
    }
};
exports.GrowthMaintenanceService = GrowthMaintenanceService;
exports.GrowthMaintenanceService = GrowthMaintenanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrowthMaintenanceService);
//# sourceMappingURL=growth-maintenance.service.js.map