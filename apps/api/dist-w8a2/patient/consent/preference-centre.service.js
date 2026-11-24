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
exports.PreferenceCentreService = exports.FALLBACK_CONSENT_DEFAULTS = exports.MARKETING_CHANNELS = void 0;
exports.tzOffsetMinutes = tzOffsetMinutes;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const consent_service_1 = require("./consent.service");
const suppression_service_1 = require("./suppression.service");
exports.MARKETING_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH'];
exports.FALLBACK_CONSENT_DEFAULTS = { quietHoursStart: '21:00', quietHoursEnd: '09:00', quietHoursTimezone: 'Africa/Cairo', maxMarketingPerDay: 1, maxMarketingPerWeek: 3, withdrawalPropagationSeconds: 60, textVersionIds: { analytics: consent_service_1.CONSENT_TEXT_PLACEHOLDER, marketing: consent_service_1.CONSENT_TEXT_PLACEHOLDER }, regimeId: 'pdpl-eg-v0' };
function tzOffsetMinutes(timeZone, at) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
        const g = (t) => Number(parts.find((p) => p.type === t).value);
        return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000) / 60000);
    }
    catch {
        return (0, config_1.cfg)().tzOffsetHours * 60;
    }
}
const hourOf = (hhmm) => Number(hhmm.slice(0, 2));
let PreferenceCentreService = class PreferenceCentreService {
    prisma;
    consents;
    suppression;
    flags;
    defaults = async () => exports.FALLBACK_CONSENT_DEFAULTS;
    constructor(prisma, consents, suppression, flags) {
        this.prisma = prisma;
        this.consents = consents;
        this.suppression = suppression;
        this.flags = flags;
    }
    setDefaultsProvider(fn) { this.defaults = fn; this.consents.setTextVersionProvider(async (m) => (await fn(m)).textVersionIds); }
    consentDefaults(market = 'EG') { return this.defaults(market).catch(() => exports.FALLBACK_CONSENT_DEFAULTS); }
    async get(sub, market = 'EG') {
        const d = await this.consentDefaults(market);
        const states = await this.consents.states(sub, ['REMINDERS', 'ANALYTICS_MEASUREMENT', ...consent_service_1.MARKETING_CONSENT_PURPOSES]);
        const prefs = await this.prisma.notificationPreference.findMany({ where: { sub } });
        const profile = await this.prisma.patientProfile.findUnique({ where: { sub }, select: { phone: true, email: true } });
        const marketingOn = await this.flags.isEnabled('growth.marketing_messaging', { market }).catch(() => false);
        const channels = [];
        for (const channel of exports.MARKETING_CHANNELS) {
            const st = states.get(`MARKETING_${channel}`);
            const pref = prefs.find((p) => p.channel === channel);
            const addr = channel === 'EMAIL' ? profile?.email : channel === 'PUSH' ? null : profile?.phone;
            channels.push({ channel, marketingConsent: st.granted, textVersion: st.version, updatedAt: st.updatedAt, channelEnabled: pref ? pref.enabled : true, suppressed: channel === 'PUSH' ? false : await this.suppression.isSuppressed([addr], channel, market), quietStart: pref?.quietStart ?? null, quietEnd: pref?.quietEnd ?? null });
        }
        return {
            version: 1,
            draftWording: [d.textVersionIds.analytics, d.textVersionIds.marketing].some((v) => v.startsWith('TODO_NEEDS_HUMAN')),
            textVersions: d.textVersionIds,
            serviceMessages: [
                { purpose: 'TRANSACTIONAL', required: true },
                { purpose: 'SECURITY', required: true },
                { purpose: 'CLINICAL', required: true },
            ],
            reminders: { consent: states.get('REMINDERS').granted, updatedAt: states.get('REMINDERS').updatedAt },
            analytics: { consent: states.get('ANALYTICS_MEASUREMENT').granted, textVersion: states.get('ANALYTICS_MEASUREMENT').version, updatedAt: states.get('ANALYTICS_MEASUREMENT').updatedAt },
            marketing: { available: marketingOn, anyConsent: channels.some((c) => c.marketingConsent), channels },
            quietHours: { start: prefs.find((p) => p.quietStart !== null)?.quietStart ?? null, end: prefs.find((p) => p.quietEnd !== null)?.quietEnd ?? null, defaultStart: hourOf(d.quietHoursStart), defaultEnd: hourOf(d.quietHoursEnd), timezone: d.quietHoursTimezone },
            caps: { perDay: d.maxMarketingPerDay, perWeek: d.maxMarketingPerWeek },
            withdrawalPropagationSeconds: d.withdrawalPropagationSeconds,
        };
    }
    async update(sub, u, o = {}) {
        const opts = { source: o.source ?? 'web', ip: o.ip };
        if (u.quietHours) {
            const { start, end } = u.quietHours;
            if (![start, end].every((h) => Number.isInteger(h) && h >= 0 && h <= 23))
                throw (0, errors_1.badRequest)('INVALID_QUIET_HOURS', 'Quiet hours are whole hours 0-23');
        }
        if (u.marketingAll === false)
            for (const ch of exports.MARKETING_CHANNELS) {
                if (await this.consents.hasConsent(sub, `MARKETING_${ch}`))
                    await this.consents.setConsent(sub, `MARKETING_${ch}`, false, { ...opts, evidence: 'unsubscribe_all' });
            }
        for (const [ch, granted] of Object.entries(u.marketing ?? {})) {
            if (!exports.MARKETING_CHANNELS.includes(ch))
                throw (0, errors_1.badRequest)('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|SMS|EMAIL|PUSH');
            if (typeof granted !== 'boolean')
                continue;
            if ((await this.consents.hasConsent(sub, `MARKETING_${ch}`)) !== granted)
                await this.consents.setConsent(sub, `MARKETING_${ch}`, granted, { ...opts, evidence: `pref_${ch.toLowerCase()}` });
            if (granted) {
                const p = await this.prisma.patientProfile.findUnique({ where: { sub }, select: { phone: true, email: true, market: true } });
                const lifted = await this.suppression.liftOwnOptOut(ch === 'EMAIL' ? [p?.email] : ch === 'PUSH' ? [] : [p?.phone], ch, p?.market ?? 'EG');
                if (lifted)
                    await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel: ch } }, create: { sub, channel: ch, enabled: true }, update: { enabled: true } });
            }
        }
        if (typeof u.analytics === 'boolean' && (await this.consents.hasConsent(sub, 'ANALYTICS_MEASUREMENT')) !== u.analytics)
            await this.consents.setConsent(sub, 'ANALYTICS_MEASUREMENT', u.analytics, { ...opts, evidence: 'pref_analytics' });
        if (typeof u.reminders === 'boolean' && (await this.consents.hasConsent(sub, 'REMINDERS')) !== u.reminders)
            await this.consents.setConsent(sub, 'REMINDERS', u.reminders, { ...opts, evidence: 'pref_reminders' });
        for (const c of u.channels ?? []) {
            if (!exports.MARKETING_CHANNELS.includes(c.channel))
                throw (0, errors_1.badRequest)('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|SMS|EMAIL|PUSH');
            await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel: c.channel } }, create: { sub, channel: c.channel, enabled: c.enabled }, update: { enabled: c.enabled } });
        }
        if (u.quietHours !== undefined) {
            const data = u.quietHours ? { quietStart: u.quietHours.start, quietEnd: u.quietHours.end } : { quietStart: null, quietEnd: null };
            for (const channel of exports.MARKETING_CHANNELS)
                await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel } }, create: { sub, channel, ...data }, update: data });
        }
        return this.get(sub, o.market ?? 'EG');
    }
};
exports.PreferenceCentreService = PreferenceCentreService;
exports.PreferenceCentreService = PreferenceCentreService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, consent_service_1.ConsentService, suppression_service_1.SuppressionService, control_plane_public_1.FlagsService])
], PreferenceCentreService);
//# sourceMappingURL=preference-centre.service.js.map