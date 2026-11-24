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
exports.ExperimentRollupService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const assignment_1 = require("./assignment");
const experiment_types_1 = require("./experiment.types");
const DAY = 86_400_000;
let ExperimentRollupService = class ExperimentRollupService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async rollup(experimentId, now = new Date()) {
        const e = await this.prisma.growthExperiment.findUniqueOrThrow({ where: { id: experimentId } });
        const exposures = await this.prisma.growthExperimentExposure.findMany({ where: { experimentId }, select: { unitHash: true, variant: true, day: true, firstAt: true } });
        const byHash = new Map(exposures.map((x) => [x.unitHash, x]));
        const metrics = [e.primaryMetric, ...(e.guardrails ?? []).map((g) => g.metric)];
        const hits = new Map();
        const windowMs = experiment_types_1.EXPERIMENT_POLICY.conversionWindowDays * DAY;
        for (const mk of new Set(metrics)) {
            const m = (0, experiment_types_1.metricByKey)(mk);
            if (!m)
                continue;
            const set = new Set();
            hits.set(mk, set);
            const events = await this.prisma.growthEvent.findMany({ where: { market: e.market, name: m.event, occurredAt: { gte: e.startedAt ?? e.createdAt, lte: now } }, select: { visitorKey: true, bookingId: true, occurredAt: true }, take: 200_000 });
            const subOfBooking = new Map();
            const bookingIds = [...new Set(events.map((v) => v.bookingId).filter((b) => !!b))];
            for (let i = 0; i < bookingIds.length; i += 1000)
                for (const b of await this.prisma.bookingIntent.findMany({ where: { id: { in: bookingIds.slice(i, i + 1000) } }, select: { id: true, sub: true } }))
                    subOfBooking.set(b.id, b.sub);
            const subs = [...new Set(subOfBooking.values())];
            const linked = new Map();
            for (let i = 0; i < subs.length; i += 1000)
                for (const t of await this.prisma.growthTouchpoint.findMany({ where: { sub: { in: subs.slice(i, i + 1000) }, visitorKey: { not: null } }, select: { sub: true, visitorKey: true }, distinct: ['sub', 'visitorKey'] })) {
                    const l = linked.get(t.sub) ?? [];
                    l.push(t.visitorKey);
                    linked.set(t.sub, l);
                }
            for (const ev of events) {
                const keys = [];
                if (ev.visitorKey)
                    keys.push(`v:${ev.visitorKey}`);
                if (ev.bookingId) {
                    const sub = subOfBooking.get(ev.bookingId);
                    if (sub) {
                        keys.push(`s:${sub}`);
                        for (const vk of linked.get(sub) ?? [])
                            keys.push(`v:${vk}`);
                    }
                }
                for (const k of keys) {
                    const h = (0, assignment_1.unitHashOf)(e.salt, k);
                    const x = byHash.get(h);
                    if (x && ev.occurredAt >= x.firstAt && ev.occurredAt.getTime() <= x.firstAt.getTime() + windowMs)
                        set.add(h);
                }
            }
        }
        const cell = new Map();
        for (const x of exposures) {
            const day = x.day.toISOString().slice(0, 10);
            const k = `${day}|${x.variant}`;
            const row = cell.get(k) ?? { day, variant: x.variant, exposures: 0, conversions: 0, guardrails: {} };
            row.exposures++;
            if (hits.get(e.primaryMetric)?.has(x.unitHash))
                row.conversions++;
            for (const g of e.guardrails ?? [])
                if (hits.get(g.metric)?.has(x.unitHash))
                    row.guardrails[g.metric] = (row.guardrails[g.metric] ?? 0) + 1;
            cell.set(k, row);
        }
        const rows = [...cell.values()];
        await this.prisma.$transaction(async (tx) => {
            await tx.growthExperimentDaily.deleteMany({ where: { experimentId } });
            if (rows.length)
                await tx.growthExperimentDaily.createMany({ data: rows.map((r) => ({ experimentId, day: new Date(r.day), variant: r.variant, exposures: r.exposures, conversions: r.conversions, guardrailCounts: r.guardrails })) });
        });
        return rows;
    }
    async rows(experimentId) {
        return (await this.prisma.growthExperimentDaily.findMany({ where: { experimentId } })).map((d) => ({ day: d.day.toISOString().slice(0, 10), variant: d.variant, exposures: d.exposures, conversions: d.conversions, guardrails: (d.guardrailCounts ?? {}) }));
    }
};
exports.ExperimentRollupService = ExperimentRollupService;
exports.ExperimentRollupService = ExperimentRollupService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ExperimentRollupService);
//# sourceMappingURL=experiment-rollup.service.js.map