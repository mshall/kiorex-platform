import { Logger } from '@nestjs/common';
import {
  DEFAULT_ROUTING, MemoryDispatchStore, NotificationService, simpleTemplate, TemplateRegistry,
  type AuditRecord, type AuditSink, type ChannelPreference, type DispatchState, type PreferenceStore, type Purpose, type TemplateDefinition,
} from '@kiorex/contracts/notify';
import type { Channel } from '@kiorex/contracts/notify';
import { cfg } from '../common/config';
import { HubChannelAdapter, InboxChannelAdapter, type MessagingHub } from '../messaging/messaging-public';
import { type NotifyKind, render, TEMPLATES } from './templates';

type TemplateRow = (typeof TEMPLATES)[NotifyKind];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** The platform's NotifyKind templates as notify-layer templates (same copy, same placeholders, all five channels). */
export function platformTemplate(kind: NotifyKind, t: TemplateRow): TemplateDefinition {
  const allowedParams = [...new Set([...placeholders(t.en), ...placeholders(t.ar)])];
  const base = simpleTemplate({
    type: kind, purpose: t.reminder ? 'REMINDER' : 'TRANSACTIONAL', en: t.en, ar: t.ar, allowedParams, quietBypass: t.bypassQuiet,
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

/** Consent and opt-out and quiet hours exactly as EngagementService applied them before the layer (KXM-NT-02). */
export interface PlatformPrefsDeps {
  hasConsent(sub: string, purpose: 'REMINDERS' | 'MARKETPLACE_PROCESSING'): Promise<boolean>;
  preference(sub: string, channel: string): Promise<{ enabled: boolean; quietStart: number | null; quietEnd: number | null } | null>;
}
export const consentPurposeOf = (p: Purpose): 'REMINDERS' | 'MARKETPLACE_PROCESSING' => (p === 'REMINDER' ? 'REMINDERS' : 'MARKETPLACE_PROCESSING');

export class PlatformPreferenceStore implements PreferenceStore {
  constructor(private readonly deps: PlatformPrefsDeps) {}
  async get(sub: string, ctx: { channel: Channel; purpose: Purpose }): Promise<ChannelPreference> {
    if (ctx.channel === 'INAPP') return {}; // the inbox is always available
    const consent = await this.deps.hasConsent(sub, consentPurposeOf(ctx.purpose));
    const pref = await this.deps.preference(sub, ctx.channel);
    const c = cfg();
    return {
      consent, optedOut: !!pref && !pref.enabled,
      quiet: { startHour: pref?.quietStart ?? c.quietStart, endHour: pref?.quietEnd ?? c.quietEnd, tzOffsetMinutes: c.tzOffsetHours * 60 },
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
  | { kind: 'SKIPPED_CONSENT'; purpose: 'REMINDERS' | 'MARKETPLACE_PROCESSING' }
  | { kind: 'SKIPPED_OPTOUT' }
  | { kind: 'FAILED'; reason: string };

export function outcomeOf(state: DispatchState, channel: string, purpose: Purpose): DeliverOutcome {
  if (state.phase === 'DEFERRED') return { kind: 'DEFERRED', until: new Date(state.nextActionAt!) };
  const a = state.attempts.find((x) => x.channel === channel);
  if (!a) return { kind: 'FAILED', reason: 'NOTIFY_REJECTED' };
  if (a.status === 'SENT' || a.status === 'DELIVERED' || a.status === 'READ') return { kind: 'SENT' };
  if (a.reason === 'CONSENT') return { kind: 'SKIPPED_CONSENT', purpose: consentPurposeOf(purpose) };
  if (a.reason === 'OPT_OUT') return { kind: 'SKIPPED_OPTOUT' };
  if (a.reason === 'NO_ADDRESS') return { kind: 'FAILED', reason: channel === 'PUSH' ? 'NO_DEVICE' : 'NO_RECIPIENT' };
  const rejected = a.reason === 'PHI_BLOCKED' || a.reason === 'SMS_TOO_LONG' || a.reason === 'RENDER_ERROR' || a.reason === 'PARAM_MISSING' || a.reason === 'PARAM_NOT_ALLOWED';
  return { kind: 'FAILED', reason: (rejected ? `${a.reason}:${a.detail ?? ''}` : (a.detail ?? a.reason ?? 'SEND_FAILED')).slice(0, 200) };
}
