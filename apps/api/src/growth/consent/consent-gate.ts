/**
 * The send gate for purposes and channels (GRW-P1-I, ARCH section 9). PURE: no I/O. The notification layer (PlatformPreferenceStore) and the
 * engagement queue feed it facts and act on the answer; the unit matrix in consent-gate.unit.spec.ts proves purpose x channel x quiet hours x suppression x caps.
 *
 * Separation of purposes: TRANSACTIONAL, SECURITY and CLINICAL never need marketing consent and are never blocked by a marketing suppression, a marketing
 * frequency cap or the marketing flag. MARKETING needs ALL of: the flag, a granted consent for that channel, no opt-out, no suppression, outside
 * quiet hours, inside the caps. SECURITY ignores opt-out and quiet hours (an OTP must arrive); CLINICAL bypasses quiet hours only when critical.
 */
export const GATE_PURPOSES = ['TRANSACTIONAL', 'SECURITY', 'CLINICAL', 'REMINDER', 'MARKETING'] as const;
export type GatePurpose = (typeof GATE_PURPOSES)[number];
export const GATE_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'INAPP'] as const;
export type GateChannel = (typeof GATE_CHANNELS)[number];
/** The consent purpose a marketing send on a channel needs. In-app inbox marketing rides the push/in-app consent. */
export const marketingPurposeFor = (channel: string) => `MARKETING_${channel === 'INAPP' ? 'PUSH' : channel}` as const;

export interface QuietWindow { startHour: number; endHour: number; tzOffsetMinutes: number }
export interface GateFacts {
  purpose: GatePurpose;
  channel: GateChannel;
  now: number;
  /** Consent granted for the purpose on this channel (REMINDERS for REMINDER, MARKETING_<channel> for MARKETING; irrelevant otherwise). */
  consent: boolean;
  optedOut: boolean;
  /** Address (phone or e-mail hash) is on the suppression list for this channel or ALL. */
  suppressed: boolean;
  quiet: QuietWindow | null;
  critical?: boolean;
  quietBypass?: boolean;
  /** growth.marketing_messaging effective for the market (launch-locked until counsel signs). */
  marketingEnabled: boolean;
  sentLast24h: number;
  sentLast7d: number;
  caps: { perDay: number; perWeek: number };
}
export type GateVerdict =
  | { allow: true }
  | { allow: false; reason: 'MARKETING_DISABLED' | 'CONSENT' | 'OPT_OUT' | 'SUPPRESSED' | 'FREQUENCY_CAP_DAY' | 'FREQUENCY_CAP_WEEK' }
  | { allow: false; reason: 'QUIET_HOURS'; until: number };

export function quietEnd(at: number, q: QuietWindow): number | null {
  if (q.startHour === q.endHour) return null;
  const off = q.tzOffsetMinutes * 60_000;
  const local = new Date(at + off);
  const h = local.getUTCHours();
  const inside = q.startHour > q.endHour ? h >= q.startHour || h < q.endHour : h >= q.startHour && h < q.endHour;
  if (!inside) return null;
  const end = new Date(local);
  end.setUTCHours(q.endHour, 0, 0, 0);
  if (end.getTime() <= local.getTime()) end.setUTCDate(end.getUTCDate() + 1);
  return end.getTime() - off;
}

export function evaluateSend(f: GateFacts): GateVerdict {
  const marketing = f.purpose === 'MARKETING';
  if (marketing && !f.marketingEnabled) return { allow: false, reason: 'MARKETING_DISABLED' };
  if ((marketing || f.purpose === 'REMINDER') && !f.consent) return { allow: false, reason: 'CONSENT' };
  if (f.purpose !== 'SECURITY' && f.optedOut) return { allow: false, reason: 'OPT_OUT' };
  if (marketing && f.suppressed) return { allow: false, reason: 'SUPPRESSED' };
  const quietExempt = f.purpose === 'SECURITY' || (f.channel === 'INAPP' && !marketing) || (f.purpose === 'CLINICAL' && f.critical === true) || f.quietBypass === true;
  if (!quietExempt && f.quiet) {
    const until = quietEnd(f.now, f.quiet);
    if (until !== null) return { allow: false, reason: 'QUIET_HOURS', until };
  }
  if (marketing) {
    if (f.caps.perDay <= 0 || f.sentLast24h >= f.caps.perDay) return { allow: false, reason: 'FREQUENCY_CAP_DAY' };
    if (f.caps.perWeek <= 0 || f.sentLast7d >= f.caps.perWeek) return { allow: false, reason: 'FREQUENCY_CAP_WEEK' };
  }
  return { allow: true };
}
