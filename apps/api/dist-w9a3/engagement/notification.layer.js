"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogAuditSink = exports.PlatformPreferenceStore = exports.consentPurposeOf = void 0;
exports.platformTemplate = platformTemplate;
exports.createPlatformRegistry = createPlatformRegistry;
exports.createPlatformNotifier = createPlatformNotifier;
exports.outcomeOf = outcomeOf;
exports.templateClassView = templateClassView;
const common_1 = require("@nestjs/common");
const market_time_1 = require("../common/market-time");
const notify_1 = require("@kiorex/contracts/notify");
const config_1 = require("../common/config");
const messaging_public_1 = require("../messaging/messaging-public");
const templates_1 = require("./templates");
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
function platformTemplate(kind, t) {
    const allowedParams = [...new Set([...placeholders(t.en), ...placeholders(t.ar)])];
    const base = (0, notify_1.simpleTemplate)({
        type: kind, purpose: t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL', en: t.en, ar: t.ar, allowedParams, quietBypass: t.bypassQuiet,
        channels: ['SMS', 'EMAIL', 'WHATSAPP', 'PUSH', 'INAPP'], smsMaxSegments: 20,
        subject: { en: 'Kiorex', ar: 'كيوريكس' },
    });
    base.channels.WHATSAPP = (c) => { const text = (0, templates_1.render)(c.locale === 'en' ? t.en : t.ar, c.params); return { text, template: { name: t.templateId, language: c.locale, vars: { body: text } } }; };
    return base;
}
function createPlatformRegistry() {
    const r = new notify_1.TemplateRegistry({ smsMaxSegments: 20 });
    for (const [kind, t] of Object.entries(templates_1.TEMPLATES))
        r.register(platformTemplate(kind, t));
    return r;
}
const consentPurposeOf = (p, channel) => p === 'REMINDER' ? 'REMINDERS' : p === 'MARKETING' ? `MARKETING_${channel === 'INAPP' || !channel ? 'PUSH' : channel}` : 'MARKETPLACE_PROCESSING';
exports.consentPurposeOf = consentPurposeOf;
class PlatformPreferenceStore {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async get(sub, ctx) {
        const marketing = ctx.purpose === 'MARKETING';
        if (ctx.channel === 'INAPP' && !marketing)
            return {};
        const c = (0, config_1.cfg)();
        if (marketing) {
            const m = this.deps.marketing;
            if (!m || !(await m.enabled(sub)))
                return { consent: false, optedOut: false, quiet: null };
            const [consent, pref, suppressed, dq] = await Promise.all([this.deps.hasConsent(sub, (0, exports.consentPurposeOf)('MARKETING', ctx.channel)), this.deps.preference(sub, ctx.channel), m.suppressed(sub, ctx.channel), m.defaultQuiet(Date.now(), sub)]);
            return { consent, optedOut: suppressed || (!!pref && !pref.enabled), quiet: { startHour: pref?.quietStart ?? dq.startHour, endHour: pref?.quietEnd ?? dq.endHour, tzOffsetMinutes: dq.tzOffsetMinutes, ...(dq.zone ? { zone: dq.zone } : {}) } };
        }
        const consent = await this.deps.hasConsent(sub, (0, exports.consentPurposeOf)(ctx.purpose));
        const pref = await this.deps.preference(sub, ctx.channel);
        return {
            consent, optedOut: !!pref && !pref.enabled,
            quiet: { startHour: pref?.quietStart ?? c.quietStart, endHour: pref?.quietEnd ?? c.quietEnd, tzOffsetMinutes: (0, market_time_1.marketOffsetMinutes)(), zone: (0, market_time_1.marketZone)() },
        };
    }
}
exports.PlatformPreferenceStore = PlatformPreferenceStore;
class LogAuditSink {
    log = new common_1.Logger('notify');
    write(r) {
        this.log.log(`${r.intentType} ${r.channel ?? '-'} ${r.status}${r.reason ? ` ${r.reason}` : ''} n=${r.notificationId}`);
    }
}
exports.LogAuditSink = LogAuditSink;
function createPlatformNotifier(hub, prefs) {
    const registry = createPlatformRegistry();
    const service = new notify_1.NotificationService({
        adapters: [new messaging_public_1.HubChannelAdapter('SMS', hub), new messaging_public_1.HubChannelAdapter('EMAIL', hub), new messaging_public_1.HubChannelAdapter('WHATSAPP', hub), new messaging_public_1.HubChannelAdapter('PUSH', hub), new messaging_public_1.InboxChannelAdapter()],
        registry, preferences: prefs, audit: new LogAuditSink(), routing: notify_1.DEFAULT_ROUTING, store: new notify_1.MemoryDispatchStore(5_000),
        clock: { now: () => Date.now() },
    });
    return { service, registry };
}
function outcomeOf(state, channel, purpose) {
    if (state.phase === 'DEFERRED')
        return { kind: 'DEFERRED', until: new Date(state.nextActionAt) };
    const a = state.attempts.find((x) => x.channel === channel);
    if (!a)
        return { kind: 'FAILED', reason: 'NOTIFY_REJECTED' };
    if (a.status === 'SENT' || a.status === 'DELIVERED' || a.status === 'READ')
        return { kind: 'SENT' };
    if (a.reason === 'CONSENT')
        return { kind: 'SKIPPED_CONSENT', purpose: (0, exports.consentPurposeOf)(purpose, channel) };
    if (a.reason === 'OPT_OUT')
        return { kind: 'SKIPPED_OPTOUT' };
    if (a.reason === 'NO_ADDRESS')
        return { kind: 'FAILED', reason: channel === 'PUSH' ? 'NO_DEVICE' : 'NO_RECIPIENT' };
    const rejected = a.reason === 'PHI_BLOCKED' || a.reason === 'SMS_TOO_LONG' || a.reason === 'RENDER_ERROR' || a.reason === 'PARAM_MISSING' || a.reason === 'PARAM_NOT_ALLOWED';
    return { kind: 'FAILED', reason: (rejected ? `${a.reason}:${a.detail ?? ''}` : (a.detail ?? a.reason ?? 'SEND_FAILED')).slice(0, 200) };
}
function templateClassView() {
    return Object.keys(templates_1.TEMPLATES).map((kind) => {
        const t = templates_1.TEMPLATES[kind];
        return { kind, messageClass: (0, templates_1.messageClassOf)(kind), purpose: t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL', promotional: t.promotional === true, copyReview: t.copyReview ?? 'APPROVED' };
    });
}
//# sourceMappingURL=notification.layer.js.map