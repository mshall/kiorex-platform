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
exports.FraudJob = exports.FraudCalibrationService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const contracts_1 = require("@kiorex/contracts");
const growth_config_service_1 = require("../config/growth-config.service");
const case_service_1 = require("./case.service");
const calibration_1 = require("./calibration");
const fraud_config_service_1 = require("./fraud-config.service");
const review_queue_service_1 = require("./review-queue.service");
const DAY = 86_400_000;
let FraudCalibrationService = class FraudCalibrationService {
    prisma;
    cfg;
    configs;
    constructor(prisma, cfg, configs) {
        this.prisma = prisma;
        this.cfg = cfg;
        this.configs = configs;
    }
    async refresh(days = 30, now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const since = new Date(now.getTime() - days * DAY);
        const rows = await this.prisma.$queryRaw `
      SELECT date_trunc('day', s."at")::date AS day, s."ruleId",
             count(DISTINCT s."caseId") AS flagged,
             count(DISTINCT s."caseId") FILTER (WHERE c."decision" LIKE 'CONFIRM%') AS confirmed,
             count(DISTINCT s."caseId") FILTER (WHERE c."decision" = 'DISMISS') AS dismissed
      FROM "FraudCaseSignal" s JOIN "FraudCase" c ON c."id" = s."caseId"
      WHERE c."market" = ${market} AND s."at" >= ${since} GROUP BY 1, 2`;
        for (const r of rows) {
            const data = { flagged: Number(r.flagged), confirmed: Number(r.confirmed), dismissed: Number(r.dismissed) };
            await this.prisma.fraudCalibration.upsert({ where: { market_day_ruleId: { market, day: r.day, ruleId: r.ruleId } }, create: { market, day: r.day, ruleId: r.ruleId, ...data }, update: data });
        }
        return rows.length;
    }
    async stats(days = 90, now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const rows = await this.prisma.fraudCalibration.findMany({ where: { market, day: { gte: new Date(now.getTime() - days * DAY) } } });
        const out = {};
        for (const r of rows) {
            const s = (out[r.ruleId] ??= { flagged: 0, confirmed: 0, dismissed: 0 });
            s.flagged += r.flagged;
            s.confirmed += r.confirmed;
            s.dismissed += r.dismissed;
        }
        return out;
    }
    async report(days = 90, now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const cfg = await this.cfg.get(market);
        const rules = (0, calibration_1.shadowReport)(cfg, await this.stats(days, now, market));
        const wouldHold = await this.prisma.fraudCase.count({ where: { market, mode: 'SHADOW', band: 'HIGH', createdAt: { gte: new Date(now.getTime() - days * DAY) } } });
        return { days, enforce: cfg.enforce, configVersion: cfg.version, wouldHaveBeenHeld: wouldHold, rules };
    }
    async propose(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const cfg = await this.cfg.get(market);
        const p = (0, calibration_1.proposeWeights)(cfg, await this.stats(90, now, market));
        if (!p.changes.length)
            return { proposed: false, changes: [] };
        const { version: _v, ...current } = cfg;
        const full = { ...current, rules: Object.fromEntries(Object.entries(cfg.rules).map(([id, r]) => [id, { ...r, ...(p.payload.rules[id] ?? {}) }])) };
        let draftId = null;
        if (contracts_1.GROWTH_CONFIG_KINDS.includes('FRAUD_RULES')) {
            try {
                draftId = (await this.configs.createSystemDraft({ kind: 'FRAUD_RULES', scope: 'GLOBAL', payload: full, reason: 'calibration proposal from labelled outcomes' })).id;
            }
            catch { }
        }
        await this.prisma.auditLog.create({ data: { actor: 'system:fraud-calibration', action: 'growth.fraud.calibration_proposal', resource: 'FraudRules', resourceId: draftId ?? undefined, metadata: { changes: JSON.parse(JSON.stringify(p.changes)), draftId, persistedAsDraft: !!draftId } } });
        return { proposed: true, changes: p.changes, draftId };
    }
    async fairness(weekStart, market = market_core_public_1.DEFAULT_MARKET) {
        const end = new Date(weekStart.getTime() + 7 * DAY);
        const byLang = await this.prisma.$queryRaw `
      SELECT coalesce(p."preferredLocale", 'unknown') AS g, count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "FraudCaseSignal" s JOIN "FraudCase" c ON c."id" = s."caseId" WHERE s."evidenceRef" = 'rel:' || r."id" AND c."band" = 'HIGH')) AS held
      FROM "ReferralRelationship" r LEFT JOIN "PatientProfile" p ON p."sub" = r."refereeSub"
      WHERE r."market" = ${market} AND r."createdAt" >= ${weekStart} AND r."createdAt" < ${end} GROUP BY 1`;
        const byCity = await this.prisma.$queryRaw `
      SELECT coalesce(pr."governorate", 'unknown') AS g, count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "FraudCaseSignal" s JOIN "FraudCase" c ON c."id" = s."caseId" WHERE s."evidenceRef" = 'rel:' || r."id" AND c."band" = 'HIGH')) AS held
      FROM "ReferralRelationship" r JOIN "BookingIntent" b ON b."id" = r."firstBookingId" JOIN "Provider" pr ON pr."id" = b."providerId"
      WHERE r."market" = ${market} AND r."createdAt" >= ${weekStart} AND r."createdAt" < ${end} GROUP BY 1`;
        const conv = (r) => r.map((x) => ({ group: x.g, total: Number(x.total), held: Number(x.held) }));
        return { weekStart: weekStart.toISOString().slice(0, 10), language: (0, calibration_1.fairnessRows)(conv(byLang)), city: (0, calibration_1.fairnessRows)(conv(byCity)), note: 'Aggregates only; groups under 10 are masked. A flagged group is a prompt for a human review of the rules, never an automatic change.' };
    }
};
exports.FraudCalibrationService = FraudCalibrationService;
exports.FraudCalibrationService = FraudCalibrationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, fraud_config_service_1.FraudConfigService, growth_config_service_1.GrowthConfigService])
], FraudCalibrationService);
let FraudJob = class FraudJob {
    queue;
    cases;
    cal;
    cfg;
    log = new common_1.Logger('fraud-job');
    timer;
    constructor(queue, cases, cal, cfg) {
        this.queue = queue;
        this.cases = cases;
        this.cal = cal;
        this.cfg = cfg;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.run().catch((e) => this.log.warn(`fraud job failed: ${e.message}`)), 60 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async run(now = new Date()) {
        const cfg = await this.cfg.get();
        const sla = await this.queue.slaSweep(now);
        const house = await this.cases.housekeeping(cfg, now);
        const rows = await this.cal.refresh(30, now);
        const proposal = now.getUTCHours() === 3 ? await this.cal.propose(now) : null;
        return { sla, house, calibrationRows: rows, proposal };
    }
};
exports.FraudJob = FraudJob;
exports.FraudJob = FraudJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [review_queue_service_1.FraudReviewQueueService, case_service_1.FraudCaseService, FraudCalibrationService, fraud_config_service_1.FraudConfigService])
], FraudJob);
//# sourceMappingURL=calibration.job.js.map