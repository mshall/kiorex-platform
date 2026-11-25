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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngagementService = exports.CHANNELS = exports.DEVICE_PLATFORMS = void 0;
exports.humanizeTimes = humanizeTimes;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const market_time_1 = require("../common/market-time");
const messaging_public_1 = require("../messaging/messaging-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
const ids_1 = require("../common/ids");
const templates_1 = require("./templates");
const notification_layer_1 = require("./notification.layer");
exports.DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'];
exports.CHANNELS = ['WHATSAPP', 'PUSH', 'SMS', 'EMAIL'];
function humanizeTimes(params, locale, zone = (0, market_core_public_1.marketTimezone)(market_core_public_1.DEFAULT_MARKET)) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        if (k === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) {
            out[k] = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-EG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`));
            continue;
        }
        out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v))
            ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-EG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone }).format(new Date(v))
            : v;
    }
    return out;
}
let EngagementService = class EngagementService {
    prisma;
    patients;
    hub;
    suppression;
    flags;
    prefCentre;
    timer;
    notifier;
    constructor(prisma, patients, hub, suppression, flags, prefCentre) {
        this.prisma = prisma;
        this.patients = patients;
        this.hub = hub;
        this.suppression = suppression;
        this.flags = flags;
        this.prefCentre = prefCentre;
        this.notifier = (0, notification_layer_1.createPlatformNotifier)(hub, new notification_layer_1.PlatformPreferenceStore({
            hasConsent: (sub, purpose) => this.patients.hasConsent(sub, purpose),
            preference: (sub, channel) => this.prisma.notificationPreference.findUnique({ where: { sub_channel: { sub, channel } } }),
            marketingSentSince: (sub, since) => this.marketingSentSince(sub, since),
            isSuppressed: (channel, hash) => this.suppression.isHashSuppressed([hash], channel),
            marketing: {
                enabled: (sub) => this.marketingEnabled(sub),
                suppressed: async (sub, channel) => {
                    const p = await this.patients.profileBySub(sub);
                    return this.suppression.isSuppressed(channel === 'EMAIL' ? [p?.email] : channel === 'PUSH' || channel === 'INAPP' ? [] : [p?.phone], channel, p?.market ?? market_core_public_1.DEFAULT_MARKET);
                },
                defaultQuiet: async (at, sub) => { const d = await this.prefCentre.consentDefaults(await this.marketOfSub(sub)); return { zone: d.quietHoursTimezone, startHour: Number(d.quietHoursStart.slice(0, 2)), endHour: Number(d.quietHoursEnd.slice(0, 2)), tzOffsetMinutes: (0, patient_public_1.tzOffsetMinutes)(d.quietHoursTimezone, new Date(at)) }; },
            },
        }));
    }
    async marketingEnabled(sub) {
        const p = await this.patients.profileBySub(sub);
        return this.flags.isEnabled('growth.marketing_messaging', { market: p?.market ?? market_core_public_1.DEFAULT_MARKET }).catch(() => false);
    }
    async marketOfSub(sub) { if (!sub)
        return market_core_public_1.DEFAULT_MARKET; return (await this.patients.profileBySub(sub).catch(() => null))?.market ?? market_core_public_1.DEFAULT_MARKET; }
    async marketingCapped(sub, currentDedupeKey, now = new Date()) {
        const d = await this.prefCentre.consentDefaults(await this.marketOfSub(sub));
        const sent = await this.marketingSentSince(sub, new Date(now.getTime() - 7 * 86_400_000), currentDedupeKey);
        const day = sent.filter((t) => t.getTime() >= now.getTime() - 86_400_000).length;
        if (d.maxMarketingPerDay <= 0 || day >= d.maxMarketingPerDay)
            return 'FREQUENCY_CAP_DAY';
        if (d.maxMarketingPerWeek <= 0 || sent.length >= d.maxMarketingPerWeek)
            return 'FREQUENCY_CAP_WEEK';
        return null;
    }
    async marketingSentSince(sub, since, excludeDedupeKey = null) {
        const marketingTemplateIds = Object.values(templates_1.TEMPLATES).filter((t) => t.marketing).map((t) => t.templateId);
        if (!marketingTemplateIds.length)
            return [];
        const rows = await this.prisma.message.findMany({ where: { sub, status: 'SENT', templateId: { in: marketingTemplateIds }, sentAt: { gte: since } }, select: { dedupeKey: true, sentAt: true } });
        const base = (k) => (k ?? '').replace(/:(INAPP|WHATSAPP|PUSH|SMS|EMAIL)$/, '');
        const me = excludeDedupeKey ? base(excludeDedupeKey) : null;
        const logical = new Map();
        for (const r of rows) {
            const b = base(r.dedupeKey) || String(r.sentAt);
            if (b !== me && r.sentAt)
                logical.set(b, r.sentAt);
        }
        return [...logical.values()];
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.processDue().catch(() => undefined), 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    setAdapter(a) { this.hub.setAdapter(a); }
    quietUntil(at, startH, endH) {
        const end = (0, market_time_1.quietWindowEnd)(at.getTime(), startH, endH);
        return end === null ? null : new Date(end);
    }
    async notify(sub, o) {
        const channels = o.exact ? [...(o.channels ?? [])] : ['INAPP', ...(o.channels ?? ['WHATSAPP', 'PUSH'])];
        const profile = await this.patients.profileBySub(sub);
        const locale = profile?.preferredLocale ?? 'ar';
        const t = templates_1.TEMPLATES[o.kind];
        const created = [];
        for (const channel of channels) {
            const dedupeKey = `${o.dedupeKey}:${channel}`;
            const exists = await this.prisma.message.findUnique({ where: { dedupeKey } });
            if (exists)
                continue;
            const m = await this.prisma.message.create({ data: { sub, bookingId: o.bookingId, channel, templateId: t.templateId, locale, params: { kind: o.kind, ...humanizeTimes(o.params ?? {}, locale) }, scheduledFor: o.scheduledFor ?? new Date(), dedupeKey } });
            created.push(m.id);
            if (m.scheduledFor <= new Date())
                await this.deliver(m.id);
        }
        return created;
    }
    async deliver(id) {
        const m = await this.prisma.message.findUnique({ where: { id } });
        if (!m || m.status !== 'SCHEDULED')
            return m?.status ?? 'MISSING';
        const params = (m.params ?? {});
        const t = templates_1.TEMPLATES[params.kind];
        const finish = (status, reason) => this.prisma.message.update({ where: { id }, data: { status, reason, ...(status === 'SENT' ? { sentAt: new Date() } : {}) } }).then(() => status);
        const purpose = t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL';
        if (purpose === 'MARKETING' && (await this.patients.hasConsent(m.sub, `MARKETING_${m.channel === 'INAPP' ? 'PUSH' : m.channel}`))) {
            const capped = await this.marketingCapped(m.sub, m.dedupeKey);
            if (capped)
                return finish('SKIPPED_FREQUENCY_CAP', capped);
        }
        const channel = m.channel;
        const profile = channel === 'INAPP' ? null : await this.patients.profileBySub(m.sub);
        const devices = channel === 'PUSH' ? await this.activeDevices(m.sub) : [];
        const deviceIds = channel === 'PUSH' ? (devices.length ? devices.map((d) => d.token) : this.hub.channelMode('PUSH') === 'mock' ? [`device:${m.sub}`] : []) : undefined;
        const allowed = this.notifier.registry.get(params.kind)?.allowedParams ?? [];
        const intentParams = Object.fromEntries(Object.entries(params).filter(([k, v]) => allowed.includes(k) && (typeof v === 'string' || typeof v === 'number')));
        try {
            const state = await this.notifier.service.dispatch({
                type: params.kind, severity: t.reminder || t.marketing ? 'ROUTINE' : 'IMPORTANT',
                recipient: { id: m.sub, phone: profile?.phone ?? undefined, email: profile?.email ?? undefined, deviceIds, locale: m.locale === 'en' ? 'en' : 'ar' },
                params: intentParams, channels: [channel],
                idempotencyKey: `${m.id}:${m.scheduledFor.getTime()}`,
                metadata: { messageId: m.id, sub: m.sub, templateId: m.templateId },
            });
            const o = (0, notification_layer_1.outcomeOf)(state, channel, purpose);
            switch (o.kind) {
                case 'SENT': return finish('SENT');
                case 'DEFERRED':
                    await this.prisma.message.update({ where: { id }, data: { scheduledFor: o.until, reason: 'QUIET_HOURS_DEFERRED' } });
                    return 'DEFERRED';
                case 'SKIPPED_CONSENT': return finish('SKIPPED_CONSENT', o.purpose);
                case 'SKIPPED_OPTOUT': return finish('SKIPPED_OPTOUT', m.channel);
                case 'FAILED': return finish('FAILED', o.reason);
            }
        }
        catch (e) {
            return finish('FAILED', String(e).slice(0, 200));
        }
    }
    async processDue(limit = 100) {
        const due = await this.prisma.message.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date() } }, orderBy: { scheduledFor: 'asc' }, take: limit });
        for (const m of due)
            await this.deliver(m.id);
        return { processed: due.length };
    }
    async scheduleBookingReminders(b, params) {
        const rem = [['REMINDER_24H', 24], ['REMINDER_2H', 2]];
        for (const [kind, h] of rem) {
            const at = new Date(b.startsAt.getTime() - h * 3600_000);
            if (at <= new Date())
                continue;
            await this.notify(b.sub, { kind, bookingId: b.id, params, scheduledFor: at, dedupeKey: `${kind}:${b.id}:${b.startsAt.getTime()}` });
        }
    }
    async cancelBookingMessages(bookingId) {
        return this.prisma.message.updateMany({ where: { bookingId, status: 'SCHEDULED' }, data: { status: 'CANCELLED', reason: 'BOOKING_CHANGED' } });
    }
    async scheduleReviewInvite(b, params, completedAt = new Date()) {
        return this.notify(b.sub, { kind: 'REVIEW_INVITATION', bookingId: b.id, params, scheduledFor: new Date(completedAt.getTime() + 2 * 3600_000), dedupeKey: `REVIEW_INVITATION:${b.id}` });
    }
    activeDevices(sub) { return this.prisma.deviceToken.findMany({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 10 }); }
    presentDevice(d) {
        return { id: d.id, platform: d.platform, appVersion: d.appVersion, locale: d.locale, createdAt: d.createdAt.toISOString(), lastSeenAt: d.lastSeenAt.toISOString() };
    }
    async registerDevice(sub, i) {
        const row = await this.prisma.deviceToken.upsert({
            where: { token: i.token },
            create: { id: (0, ids_1.newId)('kx_dev'), sub, platform: i.platform, token: i.token, appVersion: i.appVersion, locale: i.locale },
            update: { sub, platform: i.platform, appVersion: i.appVersion, locale: i.locale, revokedAt: null, lastSeenAt: new Date() },
        });
        const active = await this.prisma.deviceToken.findMany({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } });
        if (active.length > 10)
            await this.prisma.deviceToken.updateMany({ where: { id: { in: active.slice(10).map((d) => d.id) } }, data: { revokedAt: new Date() } });
        return this.presentDevice(row);
    }
    async listDevices(sub) { return (await this.activeDevices(sub)).map((d) => this.presentDevice(d)); }
    async removeDevice(sub, id) {
        const r = await this.prisma.deviceToken.updateMany({ where: { id, sub, revokedAt: null }, data: { revokedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.notFound)('DEVICE_NOT_FOUND', 'Device not found');
        return { ok: true };
    }
    inbox(sub) {
        return this.prisma.message.findMany({ where: { sub, channel: 'INAPP', status: 'SENT' }, orderBy: { createdAt: 'desc' }, take: 100 }).then((rows) => rows.map((m) => {
            const p = (m.params ?? {});
            const t = templates_1.TEMPLATES[p.kind];
            const item = this.notifier.registry.render(p.kind, 'INAPP', m.locale === 'en' ? 'en' : 'ar', Object.fromEntries(Object.entries(p).filter(([k, v]) => (this.notifier.registry.get(p.kind)?.allowedParams ?? []).includes(k) && (typeof v === 'string' || typeof v === 'number'))));
            return { id: m.id, kind: p.kind, bookingId: m.bookingId, body: item.ok ? item.body.body : (0, templates_1.render)(m.locale === 'en' ? t.en : t.ar, p), readAt: m.readAt, createdAt: m.createdAt };
        }));
    }
    async markRead(sub, id) {
        await this.prisma.message.updateMany({ where: { id, sub }, data: { readAt: new Date() } });
        return { ok: true };
    }
    async preferences(sub) {
        const rows = await this.prisma.notificationPreference.findMany({ where: { sub } });
        return exports.CHANNELS.map((c) => rows.find((r) => r.channel === c) ?? { sub, channel: c, enabled: true, quietStart: null, quietEnd: null });
    }
    async setPreference(sub, channel, p) {
        return this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel } }, create: { sub, channel, ...p }, update: p });
    }
    messageLog(limit = 100) {
        return this.prisma.message.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    }
};
exports.EngagementService = EngagementService;
exports.EngagementService = EngagementService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PatientService))),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.SuppressionService))),
    __param(5, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.PreferenceCentreService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, patient_public_1.PatientService, messaging_public_1.MessagingHub, patient_public_1.SuppressionService, control_plane_public_1.FlagsService, patient_public_1.PreferenceCentreService])
], EngagementService);
//# sourceMappingURL=engagement.service.js.map