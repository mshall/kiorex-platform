import { Logger } from '@nestjs/common';
import { marketOffsetMinutes, marketZone } from '../common/market-time';
import {
  DEFAULT_ROUTING, MemoryDispatchStore, NotificationService, simpleTemplate, TemplateRegistry,
  type AuditRecord, type AuditSink, type ChannelPreference, type DispatchState, type PreferenceStore, type Purpose, type TemplateDefinition,
} from '@kiorex/contracts/notify';
import type { Channel } from '@kiorex/contracts/notify';
import { cfg } from '../common/config';
import { HubChannelAdapter, InboxChannelAdapter, type MessagingHub } from '../messaging/messaging-public';
import { messageClassOf, type NotifyKind, render, TEMPLATES } from './templates';
import type { MessageClass } from './message-class';

type TemplateRow = (typeof TEMPLATES)[NotifyKind];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** The platform's NotifyKind templates as notify-layer templates (same copy, same placeholders, all five channels). */
export function platformTemplate(kind: NotifyKind, t: TemplateRow): TemplateDefinition {
  const allowedParams = [...new Set([...placeholders(t.en), ...placeholders(t.ar)])];
  const base = simpleTemplate({
    // a template is bound to exactly ONE purpose at definition time (ARCH section 9)
    type: kind, purpose: t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL', en: t.en, ar: t.ar, allowedParams, quietBypass: t.bypassQuiet,
    channels: ['SMS', 'EMAIL', 'WHATSAPP', 'PUSH', 'INAPP'], smsMaxSegments: 20, // legacy sends never capped SMS length
    subject: { en: 'Kiorex', ar: 'كيوريكس' },
  });
  // WhatsApp keeps the Meta template id (placeholder until approved, Docs/NEEDS_HUMAN.md); the full text rides in vars.body for the legacy transport.
  base.channels.WHATSAPP = (c) => { const text = render(c.locale === 'en' ? t.en : t.ar, c.params); return { text, template: { name: t.templateId, language: c.locale, vars: { body: text } } }; };
  return base;
}

export function createPlatformRegistry(): TemplateRegistry {
  const r = new TemplateRegistry({ smsMaxSegments: 20 });
  for (const [kind, t] of Object.entries(TEMPLATES) as [NotifyKind, TemplateRow][]) r.register(platformTemplate(kind, t));
  return r;
}

/** Consent keys the send gate asks for: the Rev 2.2 two, plus one marketing consent per channel (GRW-P1-I). */
export type GateConsentKey = 'REMINDERS' | 'MARKETPLACE_PROCESSING' | `MARKETING_${'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH'}`;
/** Consent and opt-out and quiet hours exactly as EngagementService applied them before the layer (KXM-NT-02), plus the marketing additions. */
export interface PlatformPrefsDeps {
  /**
   * GRW-P2-E: distinct MARKETING sends of a person since an instant (all channels, one logical send fans out to several channels). The lifecycle send gate and the
   * delivery path count the same rows, so campaigns and journeys share ONE frequency budget.
   */
  marketingSentSince?(sub: string, since: Date): Promise<Date[]>;
  /** GRW-P2-E: suppression by keyed address hash (the raw address is never needed here). */
  isSuppressed?(channel: string, addressHash: string): Promise<boolean>;
  hasConsent(sub: string, purpose: GateConsentKey): Promise<boolean>;
  preference(sub: string, channel: string): Promise<{ enabled: boolean; quietStart: number | null; quietEnd: number | null } | null>;
  /**
   * Marketing facts (GRW-P1-I). Absent = marketing is denied (no marketing without the dependency). `enabled`: growth.marketing_messaging effective;
   * `suppressed`: the person's phone/e-mail is on the suppression list for the channel; `defaultQuiet`: the market's marketing quiet window.
   */
  marketing?: {
    enabled(sub: string): Promise<boolean>;
    suppressed(sub: string, channel: string): Promise<boolean>;
    /** `sub` lets the implementation use the person's market (ZY readiness); absent means the default market. */
    defaultQuiet(at: number, sub?: string): Promise<{ startHour: number; endHour: number; tzOffsetMinutes: number; zone?: string }>;
  };
}
export const consentPurposeOf = (p: Purpose, channel?: string): GateConsentKey =>
  p === 'REMINDER' ? 'REMINDERS' : p === 'MARKETING' ? (`MARKETING_${channel === 'INAPP' || !channel ? 'PUSH' : channel}` as GateConsentKey) : 'MARKETPLACE_PROCESSING';

export class PlatformPreferenceStore implements PreferenceStore {
  constructor(private readonly deps: PlatformPrefsDeps) {}
  async get(sub: string, ctx: { channel: Channel; purpose: Purpose }): Promise<ChannelPreference> {
    const marketing = ctx.purpose === 'MARKETING';
    if (ctx.channel === 'INAPP' && !marketing) return {}; // the inbox is always available for service messages; marketing in the inbox still needs consent
    const c = cfg();
    if (marketing) {
      // MARKETING needs: flag effective, per-channel marketing consent, no channel opt-out, no suppression, outside quiet hours. Anything missing = deny.
      const m = this.deps.marketing;
      if (!m || !(await m.enabled(sub))) return { consent: false, optedOut: false, quiet: null };
      const [consent, pref, suppressed, dq] = await Promise.all([this.deps.hasConsent(sub, consentPurposeOf('MARKETING', ctx.channel)), this.deps.preference(sub, ctx.channel), m.suppressed(sub, ctx.channel), m.defaultQuiet(Date.now(), sub)]);
      return { consent, optedOut: suppressed || (!!pref && !pref.enabled), quiet: { startHour: pref?.quietStart ?? dq.startHour, endHour: pref?.quietEnd ?? dq.endHour, tzOffsetMinutes: dq.tzOffsetMinutes, ...(dq.zone ? { zone: dq.zone } : {}) } };
    }
    const consent = await this.deps.hasConsent(sub, consentPurposeOf(ctx.purpose));
    const pref = await this.deps.preference(sub, ctx.channel);
    return {
      consent, optedOut: !!pref && !pref.enabled,
      quiet: { startHour: pref?.quietStart ?? c.quietStart, endHour: pref?.quietEnd ?? c.quietEnd, tzOffsetMinutes: marketOffsetMinutes(), zone: marketZone() }, // the zone makes the two Cairo offset-change nights end the window at the right wall-clock hour (G-5)
    };
  }
}

/** PHI-free audit: the MessageLog row stays the system of record, so the sink only logs a masked line (no recipient, no body). */
export class LogAuditSink implements AuditSink {
  private readonly log = new Logger('notify');
  write(r: AuditRecord): void {
    this.log.log(`${r.intentType} ${r.channel ?? '-'} ${r.status}${r.reason ? ` ${r.reason}` : ''} n=${r.notificationId}`);
  }
}

export function createPlatformNotifier(hub: MessagingHub, prefs: PreferenceStore) {
  const registry = createPlatformRegistry();
  const service = new NotificationService({
    adapters: [new HubChannelAdapter('SMS', hub), new HubChannelAdapter('EMAIL', hub), new HubChannelAdapter('WHATSAPP', hub), new HubChannelAdapter('PUSH', hub), new InboxChannelAdapter()],
    registry, preferences: prefs, audit: new LogAuditSink(), routing: DEFAULT_ROUTING, store: new MemoryDispatchStore(5_000),
    clock: { now: () => Date.now() },
  });
  return { service, registry };
}

/** What EngagementService.deliver() does with a layer result for ONE channel (the engagement queue owns retries and scheduling). */
export type DeliverOutcome =
  | { kind: 'SENT' }
  | { kind: 'DEFERRED'; until: Date }
  | { kind: 'SKIPPED_CONSENT'; purpose: GateConsentKey }
  | { kind: 'SKIPPED_OPTOUT' }
  | { kind: 'FAILED'; reason: string };

export function outcomeOf(state: DispatchState, channel: string, purpose: Purpose): DeliverOutcome {
  if (state.phase === 'DEFERRED') return { kind: 'DEFERRED', until: new Date(state.nextActionAt!) };
  const a = state.attempts.find((x) => x.channel === channel);
  if (!a) return { kind: 'FAILED', reason: 'NOTIFY_REJECTED' };
  if (a.status === 'SENT' || a.status === 'DELIVERED' || a.status === 'READ') return { kind: 'SENT' };
  if (a.reason === 'CONSENT') return { kind: 'SKIPPED_CONSENT', purpose: consentPurposeOf(purpose, channel) };
  if (a.reason === 'OPT_OUT') return { kind: 'SKIPPED_OPTOUT' };
  if (a.reason === 'NO_ADDRESS') return { kind: 'FAILED', reason: channel === 'PUSH' ? 'NO_DEVICE' : 'NO_RECIPIENT' };
  const rejected = a.reason === 'PHI_BLOCKED' || a.reason === 'SMS_TOO_LONG' || a.reason === 'RENDER_ERROR' || a.reason === 'PARAM_MISSING' || a.reason === 'PARAM_NOT_ALLOWED';
  return { kind: 'FAILED', reason: (rejected ? `${a.reason}:${a.detail ?? ''}` : (a.detail ?? a.reason ?? 'SEND_FAILED')).slice(0, 200) };
}

/** The AD-6 class of every template and the notify-layer purpose it is bound to (a class is fixed at definition time; MARKETING can never ride another purpose). */
export function templateClassView(): Array<{ kind: NotifyKind; messageClass: MessageClass; purpose: Purpose; promotional: boolean; copyReview: string }> {
  return (Object.keys(TEMPLATES) as NotifyKind[]).map((kind) => {
    const t = TEMPLATES[kind];
    return { kind, messageClass: messageClassOf(kind), purpose: t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL', promotional: t.promotional === true, copyReview: t.copyReview ?? 'APPROVED' };
  });
}
