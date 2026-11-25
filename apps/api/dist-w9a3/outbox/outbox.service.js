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
exports.OutboxService = exports.backoffMs = exports.OUTBOX_MAX_ATTEMPTS = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../prisma/generated/client");
const config_1 = require("../common/config");
const prisma_service_1 = require("../prisma/prisma.service");
exports.OUTBOX_MAX_ATTEMPTS = 8;
const backoffMs = (attempts) => Math.min(300_000, 1_000 * 2 ** Math.max(0, attempts));
exports.backoffMs = backoffMs;
let OutboxService = class OutboxService {
    prisma;
    log = new common_1.Logger('outbox');
    handlers = new Map();
    timer;
    constructor(prisma) {
        this.prisma = prisma;
    }
    register(type, handler) {
        this.handlers.set(type, handler);
    }
    async enqueue(client, e) {
        try {
            return await client.outboxEvent.create({
                data: { type: e.type, aggregateType: e.aggregateType, aggregateId: e.aggregateId, target: e.target ?? 'INTERNAL', payload: e.payload, dedupeKey: e.dedupeKey },
            });
        }
        catch (err) {
            if (e.dedupeKey && err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
                return null;
            throw err;
        }
    }
    async processBatch(limit = 50) {
        const rows = await this.prisma.outboxEvent.findMany({
            where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date(Date.now() + 50) } },
            orderBy: [{ aggregateId: 'asc' }, { createdAt: 'asc' }],
            take: limit,
        });
        let sent = 0, failed = 0, dead = 0;
        for (const row of rows) {
            const r = await this.deliverOne(row);
            if (r === 'sent')
                sent++;
            else if (r === 'dead')
                dead++;
            else
                failed++;
        }
        return { processed: rows.length, sent, failed, dead };
    }
    async deliverOne(row) {
        const handler = this.handlers.get(row.type);
        try {
            if (!handler)
                throw new Error(`no handler registered for ${row.type}`);
            await handler({ ...row, payload: row.payload });
            await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null } });
            return 'sent';
        }
        catch (err) {
            const attempts = row.attempts + 1;
            const isDead = attempts >= exports.OUTBOX_MAX_ATTEMPTS;
            await this.prisma.outboxEvent.update({
                where: { id: row.id },
                data: { status: isDead ? 'DEAD' : 'FAILED', attempts, lastError: String(err instanceof Error ? err.message : err).slice(0, 500), nextAttemptAt: new Date(Date.now() + (0, exports.backoffMs)(attempts)) },
            });
            if (isDead)
                this.log.error(`outbox ${row.id} ${row.type} DEAD after ${attempts} attempts`);
            return isDead ? 'dead' : 'failed';
        }
    }
    async replay(id) {
        const row = await this.prisma.outboxEvent.findUnique({ where: { id } });
        if (!row)
            return { ok: false };
        await this.prisma.outboxEvent.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } });
        const fresh = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
        await this.deliverOne(fresh);
        const after = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
        return { ok: true, status: after.status };
    }
    list(q) {
        return this.prisma.outboxEvent.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(q.take ?? 50, 200) });
    }
    async stats() {
        const [pending, failed, dead, oldest] = await Promise.all([
            this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
            this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
            this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
            this.prisma.outboxEvent.findFirst({ where: { status: { in: ['PENDING', 'FAILED'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        ]);
        const lagMs = oldest ? Date.now() - oldest.createdAt.getTime() : 0;
        return { pending, failed, dead, lagMs, lagAlert: lagMs > 2 * 60_000 };
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.processBatch().catch((e) => this.log.error(e)), 5_000);
        this.timer.unref();
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
};
exports.OutboxService = OutboxService;
exports.OutboxService = OutboxService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], OutboxService);
//# sourceMappingURL=outbox.service.js.map