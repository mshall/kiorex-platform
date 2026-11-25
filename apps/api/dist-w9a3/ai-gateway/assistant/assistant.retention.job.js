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
exports.AssistantRetentionJob = void 0;
const common_1 = require("@nestjs/common");
const booking_public_1 = require("../../booking/booking-public");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_session_service_1 = require("./assistant.session.service");
let AssistantRetentionJob = class AssistantRetentionJob {
    prisma;
    booking;
    audit;
    sessions;
    log = new common_1.Logger('assistant-retention');
    timer;
    constructor(prisma, booking, audit, sessions) {
        this.prisma = prisma;
        this.booking = booking;
        this.audit = audit;
        this.sessions = sessions;
    }
    onModuleInit() { if (!(0, config_1.cfg)().jobsEnabled)
        return; this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`assistant retention failed: ${e.message}`)), 3_600_000); this.timer.unref(); }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date()) {
        let released = 0;
        const stale = await this.prisma.assistantSession.findMany({ where: { closedAt: null, expiresAt: { lt: now } }, take: 200 });
        for (const s of stale) {
            const ctx = this.sessions.ctxOf(s);
            if (ctx.pendingHold && s.sub) {
                await this.booking.release(s.sub, ctx.pendingHold.bookingId).catch(() => undefined);
                released++;
            }
            await this.prisma.assistantConfirmation.updateMany({ where: { sessionId: s.id, usedAt: null }, data: { usedAt: now, outcome: 'DECLINED' } });
            await this.prisma.assistantSession.update({ where: { id: s.id }, data: { closedAt: now, state: 'CLOSED', context: { ...ctx, pendingHold: undefined, shown: { providers: [], slots: [], bookings: [], specialties: [], lastList: null }, idsSeen: [] } } });
        }
        const cut = new Date(now.getTime() - 86_400_000);
        const confs = await this.prisma.assistantConfirmation.deleteMany({ where: { expiresAt: { lt: cut } } });
        const links = await this.prisma.assistantLink.deleteMany({ where: { expiresAt: { lt: cut } } });
        if (stale.length)
            await this.audit.record('sessions_expired', null, { count: stale.length });
        return { sessionsClosed: stale.length, holdsReleased: released, confirmationsDeleted: confs.count, linksDeleted: links.count };
    }
};
exports.AssistantRetentionJob = AssistantRetentionJob;
exports.AssistantRetentionJob = AssistantRetentionJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, booking_public_1.BookingService, assistant_audit_1.AssistantAudit, assistant_session_service_1.AssistantSessionService])
], AssistantRetentionJob);
//# sourceMappingURL=assistant.retention.job.js.map