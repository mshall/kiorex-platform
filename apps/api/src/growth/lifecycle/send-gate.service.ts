import { DEFAULT_MARKET, marketTimezone } from '../../market/market-core-public';
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { channelMode } from '../../messaging/messaging-public';
import { EngagementService, humanizeTimes, render, TEMPLATES, type NotifyKind } from '../../engagement/engagement-public';
import { ConsentService, PreferenceCentreService, SuppressionService } from '../../patient/patient-public';
import { PatientService } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import { detectPhi } from '../../safety/safety-public';
import { newId } from '../../common/ids';
import { capCounts, inHoldout } from './frequency-cap';
import type { JourneyDef, JourneyStep } from './journey.types';
import type { LifecyclePolicy } from './lifecycle-policy.service';
import { quietWindow } from './quiet-hours';
import { evaluateSendGate, type GateChannel, type GateInput, type GateOutcome } from './send-gate';

export interface SendRequest {
  sub: string; def: JourneyDef; step: JourneyStep; channel: GateChannel;
  /** Idempotency anchor (booking id, reward id, or `-`). Part of the dedupe key. */
  anchorId: string; anchorParams: Record<string, unknown>; now: Date; policy: LifecyclePolicy; marketingFlagOn: boolean; journeyEnabled: boolean;
}
export interface SendResult { outcome: GateOutcome; decisionId: string; messageId: string | null; channel: GateChannel }

const consentKeyOf = (purpose: JourneyStep['purpose'], channel: GateChannel) =>
  purpose === 'REMINDER' ? 'REMINDERS' : purpose === 'MARKETING' ? `MARKETING_${channel === 'INAPP' ? 'PUSH' : channel}` : 'MARKETPLACE_PROCESSING';

/**
 * Wraps the notification layer (GRW-P2-E): gathers the facts about ONE person for ONE step on ONE channel, runs the pure gate (`evaluateSendGate`), writes the decision
 * (`LifecycleMessageDecision`, append-only, with a reason code) and only on SEND hands the message to `EngagementService.notify`, whose own layer checks consent, opt-out,
 * quiet hours and PHI again (defence in depth: this gate can only make a send rarer, never looser). Nothing is cached: a STOP, a suppression or a withdrawal is seen by the very next
 * evaluation (well inside the 60 second SLO).
 */
@Injectable()
export class SendGateService {
  constructor(
    private readonly prisma: PrismaService, @Inject(forwardRef(() => PatientService)) private readonly patients: PatientService, @Inject(forwardRef(() => ConsentService)) private readonly consents: ConsentService,
    @Inject(forwardRef(() => SuppressionService)) private readonly suppression: SuppressionService, @Inject(forwardRef(() => EngagementService)) private readonly engagement: EngagementService, @Inject(forwardRef(() => PreferenceCentreService)) private readonly prefCentre: PreferenceCentreService,
  ) {}

  dedupeKeyOf(r: Pick<SendRequest, 'sub' | 'def' | 'step' | 'anchorId'>) { return `lc:${r.def.key}:${r.step.step}:${r.anchorId}:${r.sub}`; }

  /** The facts and the verdict, without writing anything (used by the console test and the run). */
  async evaluate(r: SendRequest): Promise<{ outcome: GateOutcome; input: GateInput; params: Record<string, unknown> }> {
    const { sub, step, channel, now } = r;
    const profile = await this.patients.profileBySub(sub);
    const market = profile?.market ?? DEFAULT_MARKET;
    const marketing = step.messageClass === 'MARKETING';
    const consentKey = consentKeyOf(step.purpose, channel);
    const [consent, pref, devices] = await Promise.all([
      step.messageClass === 'SECURITY' || step.messageClass === 'CLINICAL' ? Promise.resolve(true) : this.consents.hasConsent(sub, consentKey),
      this.prisma.notificationPreference.findUnique({ where: { sub_channel: { sub, channel } } }),
      channel === 'PUSH' ? this.engagement.activeDevices(sub) : Promise.resolve([]),
    ]);
    const addresses = channel === 'EMAIL' ? [profile?.email] : channel === 'PUSH' || channel === 'INAPP' ? [] : [profile?.phone];
    const suppressed = marketing && channel !== 'INAPP' ? await this.suppression.isSuppressed(addresses, channel, market) : false;
    const sent = marketing ? await this.engagement.marketingSentSince(sub, new Date(now.getTime() - 7 * 86_400_000), null) : [];
    const counts = capCounts(sent, now.getTime());
    const centre = await this.prefCentre.consentDefaults(market);
    const caps = { perDay: Math.min(r.policy.caps.perDay, centre.maxMarketingPerDay), perWeek: Math.min(r.policy.caps.perWeek, centre.maxMarketingPerWeek) };
    const t = TEMPLATES[step.kind as NotifyKind];
    const params = this.paramsFor(r);
    const text = `${render(t.en, humanizeTimes(params, 'en', marketTimezone(market)))}\n${render(t.ar, humanizeTimes(params, 'ar', marketTimezone(market)))}`;
    const dedupeKey = `${this.dedupeKeyOf(r)}:${channel}`;
    const dup = await this.prisma.message.findUnique({ where: { dedupeKey }, select: { id: true } });
    const mock = channel === 'INAPP' ? true : channelMode(channel as 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH') === 'mock';
    const input: GateInput = {
      messageClass: step.messageClass, channel, now: now.getTime(), critical: false, quietBypass: t.bypassQuiet === true,
      journeyEnabled: r.journeyEnabled, marketingFlagOn: r.marketingFlagOn,
      inHoldout: marketing && inHoldout(sub, r.def.key, r.policy.holdoutBps),
      consent, channelOptedOut: !!pref && !pref.enabled, suppressed,
      quiet: quietWindow(r.policy.quiet, pref ? { start: pref.quietStart, end: pref.quietEnd } : null),
      sentDay: counts.day, sentWeek: counts.week, caps,
      whatsappWindowOpen: false, // the platform has no inbound-window signal yet: WhatsApp always goes as an approved template
      templateApproved: mock || !t.templateId.startsWith('TODO_NEEDS_HUMAN'),
      hasAddress: channel === 'INAPP' ? true : channel === 'PUSH' ? devices.length > 0 || mock : channel === 'EMAIL' ? !!profile?.email : !!profile?.phone,
      phiHits: detectPhi(text), duplicate: !!dup,
    };
    return { outcome: evaluateSendGate(input), input, params };
  }

  /** Parameters allowlisted by the template (placeholders only); anything else in the anchor never reaches a message. */
  private paramsFor(r: SendRequest): Record<string, unknown> {
    const t = TEMPLATES[r.step.kind as NotifyKind];
    const allowed = new Set([...t.en.matchAll(/\{(\w+)\}/g), ...t.ar.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
    return Object.fromEntries(Object.entries(r.anchorParams).filter(([k, v]) => allowed.has(k) && (typeof v === 'string' || typeof v === 'number')));
  }

  async send(r: SendRequest): Promise<SendResult> {
    const { outcome, params } = await this.evaluate(r);
    let messageId: string | null = null;
    if (outcome.decision === 'SEND') {
      const ids = await this.engagement.notify(r.sub, { kind: r.step.kind as NotifyKind, params, dedupeKey: this.dedupeKeyOf(r), channels: [r.channel], exact: true });
      messageId = ids[0] ?? null;
    }
    const decision = await this.prisma.lifecycleMessageDecision.create({
      data: { id: newId('kx_lmd'), sub: r.sub, market: (await this.patients.profileBySub(r.sub))?.market ?? DEFAULT_MARKET, journeyKey: r.def.key, step: r.step.step, messageClass: r.step.messageClass, channel: r.channel, templateKey: r.step.kind, decision: outcome.decision, reason: outcome.reason, messageLogId: messageId },
    });
    return { outcome, decisionId: decision.id, messageId, channel: r.channel };
  }

  /** Writes a decision without a send (stop conditions, enrolment skips, holdout). */
  async record(i: { sub: string; market: string; def: JourneyDef; step: JourneyStep; channel: GateChannel; reason: string; decision?: 'SKIP' | 'SEND' }) {
    return this.prisma.lifecycleMessageDecision.create({ data: { id: newId('kx_lmd'), sub: i.sub, market: i.market, journeyKey: i.def.key, step: i.step.step, messageClass: i.step.messageClass, channel: i.channel, templateKey: i.step.kind, decision: i.decision ?? 'SKIP', reason: i.reason } });
  }
}
