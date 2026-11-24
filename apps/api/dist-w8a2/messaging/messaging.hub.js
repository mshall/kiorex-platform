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
exports.MessagingHub = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const outbound_http_1 = require("../common/outbound-http");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../prisma/prisma.service");
const adapters_1 = require("./adapters");
const env_1 = require("../common/providers/env");
const real_adapters_1 = require("../common/providers/real-adapters");
const notify_1 = require("@kiorex/contracts/notify");
const messaging_types_1 = require("./messaging.types");
const ORDER = ['QUEUED', 'SENT', 'DELIVERED', 'READ'];
let MessagingHub = class MessagingHub {
    prisma;
    log = new common_1.Logger('messaging');
    adapters = new Map();
    inbound = new Map();
    timer;
    constructor(prisma) {
        this.prisma = prisma;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.simulateDeliveries().catch(() => undefined), 5_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    mode() { return (0, config_1.cfg)().messagingMode; }
    channelMode(channel) { return this.adapters.get(channel)?.mode ?? (0, adapters_1.channelMode)(channel); }
    adapter(channel) {
        return this.adapters.get(channel) ?? (0, adapters_1.createMessagingAdapter)(channel);
    }
    setAdapter(a) { this.adapters.set(a.channel, a); }
    onInbound(channel, h) { this.inbound.set(channel, h); }
    async send(m) {
        const adapter = this.adapter(m.channel);
        const mock = adapter.mode === 'mock';
        const row = await this.prisma.messageLog.create({
            data: { messageId: m.messageId, channel: m.channel, direction: 'OUT', mode: adapter.mode, sub: m.sub, recipient: mock ? m.to : null, recipientMasked: (0, messaging_types_1.maskRecipient)(m.channel, m.to), templateId: m.templateId, locale: m.locale, body: mock ? m.body : null, status: 'QUEUED' },
        });
        try {
            const r = await adapter.send(m);
            if (!r.ok && r.invalidToken && m.channel === 'PUSH')
                await this.prisma.deviceToken.updateMany({ where: { token: m.to, revokedAt: null }, data: { revokedAt: new Date() } });
            if (!r.ok) {
                const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: r.error ?? 'SEND_FAILED', failedAt: new Date() } });
                this.log.warn(`[${m.channel}] ${m.templateId} log=${row.id} FAILED ${r.error ?? ''}`);
                return { ...failed, ok: false };
            }
            const sent = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'SENT', providerRef: r.providerRef, sentAt: new Date() } });
            this.log.log(`[${m.channel}] ${m.templateId} log=${row.id} SENT`);
            return { ...sent, ok: true };
        }
        catch (e) {
            const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(e instanceof Error ? e.message : e).slice(0, 200), failedAt: new Date() } });
            this.log.warn(`[${m.channel}] ${m.templateId} log=${row.id} FAILED (adapter error)`);
            return { ...failed, ok: false };
        }
    }
    async receive(m) {
        const row = await this.prisma.messageLog.create({
            data: { channel: m.channel, direction: 'IN', mode: this.channelMode(m.channel), recipient: m.from, recipientMasked: (0, messaging_types_1.maskRecipient)(m.channel, m.from), body: this.channelMode(m.channel) === 'mock' ? (m.text ?? m.buttonPayload ?? '') : null, status: 'RECEIVED', providerRef: m.providerRef, sentAt: new Date() },
        });
        const h = this.inbound.get(m.channel);
        if (h)
            await h({ ...m, logId: row.id });
        return row;
    }
    async simulateDeliveries() {
        const r = await this.prisma.messageLog.updateMany({ where: { mode: 'mock', direction: 'OUT', status: 'SENT' }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
        return { delivered: r.count };
    }
    async simulate(id, state) {
        if (!messaging_types_1.SIMULATABLE_STATES.includes(state))
            throw (0, errors_1.notFound)('UNSUPPORTED_STATE', `state must be one of ${messaging_types_1.SIMULATABLE_STATES.join('|')}`);
        const row = await this.prisma.messageLog.findUnique({ where: { id } });
        if (!row || row.mode !== 'mock' || row.direction !== 'OUT')
            throw (0, errors_1.notFound)('MESSAGE_NOT_SIMULATABLE', 'Only mock outbound messages can be simulated');
        const now = new Date();
        if (state !== 'FAILED' && ORDER.indexOf(row.status) >= ORDER.indexOf(state))
            return row;
        const data = state === 'FAILED' ? { status: 'FAILED', failedAt: now, error: 'SIMULATED_FAILURE' } : state === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: now } : { status: 'READ', readAt: now, deliveredAt: row.deliveredAt ?? now };
        return this.prisma.messageLog.update({ where: { id }, data });
    }
    async handleStatusWebhook(channel, rawBody, headers) {
        const ch = channel.toUpperCase();
        const kind = (0, real_adapters_1.messagingKindOf)(ch);
        if (!kind || ((0, env_1.providerEnv)(kind).mode === 'mock' && (0, config_1.cfg)().isProd))
            throw (0, errors_1.notFound)('NOT_FOUND', 'Not found');
        const env = (0, env_1.providerEnv)(kind);
        const mapping = (0, real_adapters_1.messagingMapping)(kind);
        if (!mapping.verifyWebhook({ secret: env.webhookSecret, rawBody, headers, publicUrl: env.publicWebhookUrl }))
            throw new errors_1.ApiError(401, 'INVALID_SIGNATURE', 'Signature rejected');
        const confirm = mapping.subscriptionConfirmUrl?.(rawBody);
        if (confirm) {
            await (0, outbound_http_1.outboundFetch)(confirm, { method: 'GET' }).catch(() => undefined);
            return { applied: 0, ignored: 0 };
        }
        let applied = 0;
        let ignored = 0;
        for (const inb of mapping.parseInbound?.(rawBody) ?? []) {
            await this.receive({ channel: ch, ...inb });
            applied++;
        }
        for (const raw of mapping.parseStatusWebhook(rawBody)) {
            const status = (0, notify_1.normalizeVendorStatus)(kind, raw.status);
            if (!status || status === 'SKIPPED') {
                ignored++;
                continue;
            }
            const ev = { ...raw, status };
            const row = await this.prisma.messageLog.findFirst({ where: { channel: ch, direction: 'OUT', providerRef: ev.providerRef } });
            if (!row) {
                ignored++;
                continue;
            }
            const at = ev.occurredAt && !Number.isNaN(Date.parse(ev.occurredAt)) ? new Date(ev.occurredAt) : new Date();
            if (ev.status === 'FAILED') {
                if (row.status === 'FAILED' || row.status === 'READ') {
                    ignored++;
                    continue;
                }
                await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', failedAt: at, error: ev.error ?? 'DELIVERY_FAILED' } });
                if (row.messageId)
                    await this.prisma.message.updateMany({ where: { id: row.messageId }, data: { status: 'FAILED', reason: (ev.error ?? 'DELIVERY_FAILED').slice(0, 200) } });
                applied++;
                continue;
            }
            if ((0, notify_1.mergeStatus)(row.status, ev.status) === row.status) {
                ignored++;
                continue;
            }
            const data = ev.status === 'READ' ? { status: 'READ', readAt: at, deliveredAt: row.deliveredAt ?? at } : ev.status === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: at } : { status: ev.status, sentAt: row.sentAt ?? at };
            await this.prisma.messageLog.update({ where: { id: row.id }, data });
            applied++;
        }
        return { applied, ignored };
    }
    async list(q) {
        return this.prisma.messageLog.findMany({
            where: { ...(q.channel ? { channel: q.channel.toUpperCase() } : {}), ...(q.status ? { status: q.status.toUpperCase() } : {}), ...(q.direction ? { direction: q.direction.toUpperCase() } : {}), ...(q.to ? { recipient: q.to } : {}), ...(q.since ? { createdAt: { gte: q.since } } : {}) },
            orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 100, 500),
        });
    }
    async stats() {
        const rows = await this.prisma.messageLog.groupBy({ by: ['channel', 'direction', 'status'], _count: true });
        return { mode: (0, config_1.cfg)().messagingMode, channels: messaging_types_1.MSG_CHANNELS, counts: rows.map((r) => ({ channel: r.channel, direction: r.direction, status: r.status, count: r._count })) };
    }
    async clear(channel) {
        if ((0, config_1.cfg)().messagingMode !== 'mock')
            throw (0, errors_1.notFound)('NOT_FOUND', 'Not found');
        return this.prisma.messageLog.deleteMany({ where: channel ? { channel: channel.toUpperCase() } : {} });
    }
};
exports.MessagingHub = MessagingHub;
exports.MessagingHub = MessagingHub = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MessagingHub);
//# sourceMappingURL=messaging.hub.js.map