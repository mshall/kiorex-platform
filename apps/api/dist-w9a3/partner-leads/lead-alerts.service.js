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
exports.LeadAlertsService = exports.ALERT_CHANNELS = void 0;
const common_1 = require("@nestjs/common");
const market_time_1 = require("../common/market-time");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const engagement_public_1 = require("../engagement/engagement-public");
const messaging_public_1 = require("../messaging/messaging-public");
const prisma_service_1 = require("../prisma/prisma.service");
exports.ALERT_CHANNELS = ['EMAIL', 'WHATSAPP', 'PUSH'];
const ACTIVE_DAYS = 90;
const KIND_LABEL = {
    CLINIC: { en: 'Clinic', ar: 'عيادة' }, NURSE: { en: 'Nurse', ar: 'تمريض' }, PHARMACY: { en: 'Pharmacy', ar: 'صيدلية' }, LAB: { en: 'Lab', ar: 'معمل' },
};
const only = (xs, fallback = exports.ALERT_CHANNELS) => [...new Set((xs ?? [...fallback]).filter((c) => exports.ALERT_CHANNELS.includes(c)))];
let LeadAlertsService = class LeadAlertsService {
    prisma;
    hub;
    log = new common_1.Logger('lead-alerts');
    timer;
    touched = new Map();
    notifier;
    constructor(prisma, hub) {
        this.prisma = prisma;
        this.hub = hub;
        this.notifier = (0, engagement_public_1.createPlatformNotifier)(hub, {
            get: async (sub, ctx) => {
                const c = await this.prisma.opsStaffContact.findUnique({ where: { sub } });
                const q = (0, config_1.cfg)();
                return { consent: !!c?.leadAlerts, optedOut: !c || !c.channels.includes(ctx.channel), quiet: { startHour: q.quietStart, endHour: q.quietEnd, tzOffsetMinutes: (0, market_time_1.marketOffsetMinutes)() } };
            },
        });
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.processDue().catch(() => undefined), 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async touch(u, force = false) {
        if (!u.roles?.some((r) => auth_1.OPS_ROLES.includes(r)))
            return;
        const last = this.touched.get(u.sub) ?? 0;
        if (!force && Date.now() - last < 5 * 60_000)
            return;
        this.touched.set(u.sub, Date.now());
        const locale = u.locale === 'ar' ? 'ar' : 'en';
        const roles = u.roles.filter((r) => auth_1.OPS_ROLES.includes(r));
        await this.prisma.opsStaffContact.upsert({
            where: { sub: u.sub },
            create: { sub: u.sub, name: u.name ?? null, phone: u.phone ?? null, email: u.email ?? null, roles, locale },
            update: { name: u.name ?? undefined, phone: u.phone ?? undefined, email: u.email ?? undefined, roles, locale, lastSeenAt: new Date() },
        });
    }
    async config() {
        const c = await this.prisma.leadAlertConfig.findUnique({ where: { id: 'global' } });
        return { enabled: c?.enabled ?? true, channels: only(c?.channels), updatedBy: c?.updatedBy ?? null, updatedAt: c?.updatedAt ?? null };
    }
    async setConfig(actor, b) {
        if (b.channels && b.channels.some((c) => !exports.ALERT_CHANNELS.includes(c)))
            throw (0, errors_1.badRequest)('INVALID_CHANNEL', 'Unknown channel');
        const cur = await this.config();
        const data = { enabled: b.enabled ?? cur.enabled, channels: b.channels ? only(b.channels) : cur.channels, updatedBy: actor };
        await this.prisma.leadAlertConfig.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
        await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.alert_config_changed', resource: 'LeadAlertConfig', resourceId: 'global', metadata: { enabled: data.enabled, channels: data.channels } } });
        return this.config();
    }
    activeSince() { return new Date(Date.now() - ACTIVE_DAYS * 86_400_000); }
    async recipients() {
        const rows = await this.prisma.opsStaffContact.findMany({ where: { lastSeenAt: { gte: this.activeSince() } }, orderBy: [{ name: 'asc' }, { sub: 'asc' }] });
        return rows.map((r) => ({ sub: r.sub, name: r.name, roles: r.roles, leadAlerts: r.leadAlerts, channels: only(r.channels), hasPhone: !!r.phone, hasEmail: !!r.email, lastSeenAt: r.lastSeenAt }));
    }
    async setRecipient(actor, sub, b) {
        if (b.channels && b.channels.some((c) => !exports.ALERT_CHANNELS.includes(c)))
            throw (0, errors_1.badRequest)('INVALID_CHANNEL', 'Unknown channel');
        if (!(await this.prisma.opsStaffContact.findUnique({ where: { sub } })))
            throw (0, errors_1.notFound)('OPS_STAFF_NOT_FOUND', 'Team member not found');
        await this.prisma.opsStaffContact.update({ where: { sub }, data: { ...(b.leadAlerts !== undefined ? { leadAlerts: b.leadAlerts } : {}), ...(b.channels ? { channels: only(b.channels) } : {}) } });
        await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.alert_recipient_changed', resource: 'OpsStaffContact', resourceId: sub, metadata: { leadAlerts: b.leadAlerts, channels: b.channels } } });
        return (await this.recipients()).find((r) => r.sub === sub);
    }
    async settings() { return { ...(await this.config()), availableChannels: exports.ALERT_CHANNELS, recipients: await this.recipients() }; }
    async unread(sub) {
        const c = await this.prisma.opsStaffContact.findUnique({ where: { sub }, select: { leadsSeenAt: true } });
        const count = await this.prisma.partnerLead.count({ where: { status: 'NEW', ...(c?.leadsSeenAt ? { OR: [{ createdAt: { gt: c.leadsSeenAt } }, { updatedAt: { gt: c.leadsSeenAt } }] } : {}) } });
        return { count };
    }
    async markSeen(u) {
        await this.touch(u, true);
        await this.prisma.opsStaffContact.update({ where: { sub: u.sub }, data: { leadsSeenAt: new Date() } }).catch(() => undefined);
        return { count: 0 };
    }
    async onLead(lead, eventAt) {
        try {
            const conf = await this.config();
            if (!conf.enabled)
                return { created: 0 };
            const staff = await this.prisma.opsStaffContact.findMany({ where: { leadAlerts: true, lastSeenAt: { gte: this.activeSince() } } });
            let created = 0;
            for (const s of staff) {
                if (!s.roles.some((r) => auth_1.OPS_ROLES.includes(r)))
                    continue;
                for (const ch of only(s.channels).filter((c) => conf.channels.includes(c))) {
                    const dedupeKey = `lead:${lead.id}:${eventAt.getTime()}:${s.sub}:${ch}`;
                    try {
                        await this.prisma.leadAlertDelivery.create({ data: { id: (0, ids_1.newId)('la'), dedupeKey, leadId: lead.id, staffSub: s.sub, channel: ch, status: 'SCHEDULED', scheduledFor: new Date() } });
                        created++;
                    }
                    catch { }
                }
            }
            await this.processDue(lead);
            return { created };
        }
        catch (e) {
            this.log.warn(`lead alert failed lead=${lead.id}: ${e.message}`);
            return { created: 0 };
        }
    }
    async processDue(known) {
        const due = await this.prisma.leadAlertDelivery.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date() } }, orderBy: { scheduledFor: 'asc' }, take: 200 });
        for (const d of due)
            await this.deliver(d.id, known?.id === d.leadId ? known : undefined);
        return { processed: due.length };
    }
    async deliver(id, known) {
        const d = await this.prisma.leadAlertDelivery.findUnique({ where: { id } });
        if (!d || d.status !== 'SCHEDULED')
            return;
        const finish = (status, reason) => this.prisma.leadAlertDelivery.update({ where: { id }, data: { status, reason, ...(status === 'SENT' ? { sentAt: new Date() } : {}) } });
        const s = await this.prisma.opsStaffContact.findUnique({ where: { sub: d.staffSub } });
        const lead = known ?? (await this.prisma.partnerLead.findUnique({ where: { id: d.leadId }, select: { id: true, kind: true, orgName: true } }));
        if (!s || !lead) {
            await finish('SKIPPED', 'GONE');
            return;
        }
        const conf = await this.config();
        if (!conf.enabled || !conf.channels.includes(d.channel)) {
            await finish('SKIPPED', 'DISABLED');
            return;
        }
        const locale = s.locale === 'ar' ? 'ar' : 'en';
        const channel = d.channel;
        const deviceIds = channel === 'PUSH' ? await this.devices(s.sub) : undefined;
        try {
            const state = await this.notifier.service.dispatch({
                type: 'OPS_LEAD_ALERT', severity: 'IMPORTANT',
                recipient: { id: s.sub, phone: s.phone ?? undefined, email: s.email ?? undefined, deviceIds, locale },
                params: { org: lead.orgName, kindLabel: (KIND_LABEL[lead.kind] ?? { en: lead.kind, ar: lead.kind })[locale] }, channels: [channel],
                idempotencyKey: `${d.id}:${d.scheduledFor.getTime()}`,
                metadata: { sub: s.sub, templateId: 'ops.lead_alert' },
            });
            const o = (0, engagement_public_1.outcomeOf)(state, channel, 'TRANSACTIONAL');
            switch (o.kind) {
                case 'SENT':
                    await finish('SENT');
                    break;
                case 'DEFERRED':
                    await this.prisma.leadAlertDelivery.update({ where: { id }, data: { scheduledFor: o.until, reason: 'QUIET_HOURS_DEFERRED' } });
                    break;
                case 'SKIPPED_CONSENT':
                    await finish('SKIPPED', 'CONSENT');
                    break;
                case 'SKIPPED_OPTOUT':
                    await finish('SKIPPED', 'OPT_OUT');
                    break;
                case 'FAILED':
                    await finish(o.reason.startsWith('NO_') ? 'SKIPPED' : 'FAILED', o.reason);
                    break;
            }
        }
        catch (e) {
            await finish('FAILED', String(e).slice(0, 200));
        }
    }
    async devices(sub) {
        const rows = await this.prisma.deviceToken.findMany({ where: { sub, revokedAt: null }, take: 10 });
        return rows.length ? rows.map((r) => r.token) : this.hub.channelMode('PUSH') === 'mock' ? [`device:${sub}`] : [];
    }
};
exports.LeadAlertsService = LeadAlertsService;
exports.LeadAlertsService = LeadAlertsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, messaging_public_1.MessagingHub])
], LeadAlertsService);
//# sourceMappingURL=lead-alerts.service.js.map