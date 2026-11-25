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
exports.FraudReviewQueueService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const case_service_1 = require("./case.service");
const BULK_MAX = 100;
let FraudReviewQueueService = class FraudReviewQueueService {
    prisma;
    cases;
    constructor(prisma, cases) {
        this.prisma = prisma;
        this.cases = cases;
    }
    async list(q, now = new Date()) {
        const where = {
            market: q.market ?? market_core_public_1.DEFAULT_MARKET, ...(q.status ? { status: q.status } : { status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] } }), ...(q.kind ? { kind: q.kind } : {}), ...(q.band ? { band: q.band } : {}),
            ...(q.breached ? { slaDueAt: { lt: now } } : {}),
        };
        const rows = await this.prisma.fraudCase.findMany({ where, orderBy: [{ band: 'desc' }, { slaDueAt: 'asc' }], take: Math.min(Math.max(q.take ?? 50, 1), 200) });
        return rows.map((c) => ({ id: c.id, kind: c.kind, score: c.score, band: c.band, status: c.status, mode: c.mode, slaDueAt: c.slaDueAt, breached: !!c.slaDueAt && c.slaDueAt < now && ['OPEN', 'IN_REVIEW', 'APPEALED'].includes(c.status), assignedTo: c.assignedTo, createdAt: c.createdAt, subjectRef: c.subjectHash.slice(0, 12) }));
    }
    async summary(now = new Date(), market = market_core_public_1.DEFAULT_MARKET) {
        const open = await this.prisma.fraudCase.groupBy({ by: ['kind', 'band', 'mode'], where: { market, status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] } }, _count: { _all: true } });
        const breached = await this.prisma.fraudCase.count({ where: { market, status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] }, slaDueAt: { lt: now } } });
        return { open: open.map((r) => ({ kind: r.kind, band: r.band, mode: r.mode, count: r._count._all })), breached };
    }
    async bulkDismiss(ids, actor, reason, cfg) {
        if (!reason || reason.trim().length < 10)
            throw new errors_1.ApiError(400, 'REASON_REQUIRED', 'A bulk dismissal needs a reason (at least 10 characters)');
        if (!ids.length || ids.length > BULK_MAX)
            throw new errors_1.ApiError(400, 'GROWTH_INVALID_REQUEST', `Send 1 to ${BULK_MAX} case ids`);
        const rows = await this.prisma.fraudCase.findMany({ where: { id: { in: ids }, status: { in: ['OPEN', 'IN_REVIEW'] }, band: { in: ['LOW', 'MEDIUM'] } }, select: { id: true } });
        let done = 0;
        for (const r of rows) {
            try {
                await this.cases.decide(r.id, actor, { decision: 'DISMISS', note: reason }, cfg);
                done++;
            }
            catch { }
        }
        return { requested: ids.length, dismissed: done, skipped: ids.length - done };
    }
    async slaSweep(now = new Date()) {
        const late = await this.prisma.fraudCase.findMany({ where: { status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] }, slaDueAt: { lt: now } }, select: { id: true, kind: true, band: true } });
        let raised = 0;
        for (const c of late) {
            if (await this.prisma.auditLog.findFirst({ where: { action: 'growth.fraud.sla_breached', resourceId: c.id }, select: { id: true } }))
                continue;
            await this.prisma.auditLog.create({ data: { actor: 'system:fraud', action: 'growth.fraud.sla_breached', resource: 'FraudCase', resourceId: c.id, metadata: { kind: c.kind, band: c.band } } });
            raised++;
        }
        return { breached: late.length, raised };
    }
};
exports.FraudReviewQueueService = FraudReviewQueueService;
exports.FraudReviewQueueService = FraudReviewQueueService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, case_service_1.FraudCaseService])
], FraudReviewQueueService);
//# sourceMappingURL=review-queue.service.js.map