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
exports.CorporateJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const corporate_benefit_service_1 = require("./corporate-benefit.service");
const corporate_member_service_1 = require("./corporate-member.service");
let CorporateJob = class CorporateJob {
    prisma;
    members;
    benefit;
    log = new common_1.Logger('corporate-job');
    timer;
    constructor(prisma, members, benefit) {
        this.prisma = prisma;
        this.members = members;
        this.benefit = benefit;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`corporate housekeeping failed: ${e.message}`)), 3600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        const endedMembers = await this.members.endExpired(now);
        const releasedHolds = await this.benefit.releaseStale(now);
        const r = await this.prisma.$queryRaw `SELECT growth_purge_corporate(${now}::timestamptz) AS r`;
        const problems = await this.benefit.reconcile();
        if (problems.length)
            this.log.error(`corporate ledger reconciliation found ${problems.length} problem(s): ${problems.slice(0, 5).join(' | ')}`);
        return { endedMembers, releasedHolds, hrBatchesPurged: Number(r[0].r.corporateHrBatchesPurged), hrRowsPurged: Number(r[0].r.corporateHrRowsPurged), problems };
    }
};
exports.CorporateJob = CorporateJob;
exports.CorporateJob = CorporateJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, corporate_member_service_1.CorporateMemberService, corporate_benefit_service_1.CorporateBenefitService])
], CorporateJob);
//# sourceMappingURL=corporate.job.js.map