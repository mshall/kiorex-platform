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
exports.AutomationJob = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const automation_triggers_service_1 = require("./automation-triggers.service");
const INSTANCE = `${process.pid}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
let AutomationJob = class AutomationJob {
    prisma;
    triggers;
    log = new common_1.Logger('automation-job');
    timer;
    constructor(prisma, triggers) {
        this.prisma = prisma;
        this.triggers = triggers;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`automation tick failed: ${e.message}`)), 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        const run = await this.prisma.growthJobRun.create({ data: { job: 'automation', instanceId: INSTANCE, startedAt: now } });
        try {
            const r = await this.triggers.scan(now);
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), rows: r.enrolled ?? 0 } });
            return r;
        }
        catch (e) {
            await this.prisma.growthJobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error: e.message.slice(0, 300) } });
            throw e;
        }
    }
};
exports.AutomationJob = AutomationJob;
exports.AutomationJob = AutomationJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, automation_triggers_service_1.AutomationTriggersService])
], AutomationJob);
//# sourceMappingURL=automation.job.js.map