import type { QuietHours } from '@kiorex/contracts/notify';
import { MESSAGE_CLASSES, type MessageClass } from '../../engagement/engagement-public';
import { quietEnd } from './quiet-hours';

/**
 * The lifecycle send gate (GRW-P2-E, ARCH 9, AD-6): PURE decision, one reason code for every outcome. The service gathers the facts and records the decision; nothing
 * here touches a database or the clock. Four message classes only. Only MARKETING is subject to the marketing flag, suppression, caps and the holdout slice.
 *
 * Order (the order IS the specification, a test fixes it):
 *   journey enabled -> [MARKETING: flag, holdout] -> consent -> channel opt-out -> [MARKETING: suppression] -> quiet hours (deferral) -> [MARKETING: frequency cap]
 *   -> WhatsApp window and template -> address -> PHI guard -> duplicate.
 */
export { MESSAGE_CLASSES, type MessageClass };
export type GateChannel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH' | 'INAPP';

export const GATE_REASONS = [
  'OK', 'JOURNEY_DISABLED', 'MARKETING_FLAG_OFF', 'HOLDOUT', 'NO_CONSENT', 'CHANNEL_OPTED_OUT', 'SUPPRESSED', 'QUIET_HOURS', 'CAP_DAY', 'CAP_WEEK',
  'WHATSAPP_TEMPLATE_REQUIRED', 'NO_ADDRESS', 'PHI_BLOCKED', 'DUPLICATE', 'STOPPED', 'NOT_ELIGIBLE',
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

export interface GateInput {
  messageClass: MessageClass;
  channel: GateChannel;
  now: number;
  /** CLINICAL only: severity CRITICAL bypasses quiet hours and a channel opt-out (KX-24). */
  critical?: boolean;
  /** Template-level bypass of quiet hours (a safety notice already declares it). Never honoured for MARKETING. */
  quietBypass?: boolean;
  journeyEnabled: boolean;
  /** `growth.marketing_messaging` effective for the person's market. */
  marketingFlagOn: boolean;
  inHoldout: boolean;
  /** The consent the class and channel need (REMINDERS or marketplace processing, or the channel's marketing consent), already looked up. SECURITY ignores it. */
  consent: boolean;
  channelOptedOut: boolean;
  suppressed: boolean;
  quiet: QuietHours | null;
  /** Distinct MARKETING sends in the last 24 hours and 7 days, all channels, not counting this one. */
  sentDay: number;
  sentWeek: number;
  caps: { perDay: number; perWeek: number };
  whatsappWindowOpen: boolean;
  /** An approved template exists for this message (mock mode treats every template as approved). */
  templateApproved: boolean;
  hasAddress: boolean;
  phiHits: readonly string[];
  duplicate: boolean;
}

export type GateOutcome = { decision: 'SEND'; reason: 'OK' } | { decision: 'SKIP'; reason: Exclude<GateReason, 'OK'>; deferUntil?: number };
const skip = (reason: Exclude<GateReason, 'OK'>, deferUntil?: number): GateOutcome => ({ decision: 'SKIP', reason, ...(deferUntil !== undefined ? { deferUntil } : {}) });

export function evaluateSendGate(i: GateInput): GateOutcome {
  const marketing = i.messageClass === 'MARKETING';
  if (!i.journeyEnabled) return skip('JOURNEY_DISABLED');
  if (marketing) {
    if (!i.marketingFlagOn) return skip('MARKETING_FLAG_OFF');
    if (i.inHoldout) return skip('HOLDOUT');
  }
  // consent: SECURITY is always allowed on its channel; CLINICAL needs none (it is the service itself); the others need what the class needs
  // (the in-app inbox is always available for service messages and cards; marketing in the inbox still needs consent)
  if ((i.messageClass === 'TRANSACTIONAL' && i.channel !== 'INAPP') || marketing) { if (!i.consent) return skip('NO_CONSENT'); }
  const bypassesOptOut = i.messageClass === 'SECURITY' || (i.messageClass === 'CLINICAL' && i.critical === true);
  if (!bypassesOptOut && i.channel !== 'INAPP' && i.channelOptedOut) return skip('CHANNEL_OPTED_OUT');
  if (marketing && i.suppressed) return skip('SUPPRESSED');
  const quietExempt = i.channel === 'INAPP' || i.messageClass === 'SECURITY' || (i.messageClass === 'CLINICAL' && i.critical === true) || (!marketing && i.quietBypass === true);
  if (!quietExempt && i.quiet) {
    const until = quietEnd(i.now, i.quiet);
    if (until !== null) return skip('QUIET_HOURS', until);
  }
  if (marketing) {
    if (i.caps.perDay <= 0 || i.sentDay >= i.caps.perDay) return skip('CAP_DAY');
    if (i.caps.perWeek <= 0 || i.sentWeek >= i.caps.perWeek) return skip('CAP_WEEK');
  }
  if (i.channel === 'WHATSAPP' && !i.whatsappWindowOpen && !i.templateApproved) return skip('WHATSAPP_TEMPLATE_REQUIRED');
  if (!i.hasAddress) return skip('NO_ADDRESS');
  if (i.phiHits.length > 0) return skip('PHI_BLOCKED');
  if (i.duplicate) return skip('DUPLICATE');
  return { decision: 'SEND', reason: 'OK' };
}
