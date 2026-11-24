import { Injectable } from '@nestjs/common';
import { cfg } from '../../common/config';
import { badRequest } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService, CONSENT_TEXT_PLACEHOLDER, MARKETING_CONSENT_PURPOSES } from './consent.service';
import { SuppressionService } from './suppression.service';

export const MARKETING_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH'] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

/** CONSENT_DEFAULTS payload as the preference centre and the send gate read it (the growth module supplies the resolved version; defaults below are PROPOSED_DEFAULT). */
export interface ConsentDefaults { quietHoursStart: string; quietHoursEnd: string; quietHoursTimezone: string; maxMarketingPerDay: number; maxMarketingPerWeek: number; withdrawalPropagationSeconds: number; textVersionIds: { analytics: string; marketing: string }; regimeId: string }
export const FALLBACK_CONSENT_DEFAULTS: ConsentDefaults = { quietHoursStart: '21:00', quietHoursEnd: '09:00', quietHoursTimezone: 'Africa/Cairo', maxMarketingPerDay: 1, maxMarketingPerWeek: 3, withdrawalPropagationSeconds: 60, textVersionIds: { analytics: CONSENT_TEXT_PLACEHOLDER, marketing: CONSENT_TEXT_PLACEHOLDER }, regimeId: 'pdpl-eg-v0' };
export type ConsentDefaultsProvider = (market: string) => Promise<ConsentDefaults>;

/** Minutes east of UTC for an IANA zone at an instant (DST aware; Cairo is +2 or +3). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch { return cfg().tzOffsetHours * 60; }
}

const hourOf = (hhmm: string) => Number(hhmm.slice(0, 2));
export interface PreferenceUpdate {
  analytics?: boolean;
  reminders?: boolean;
  marketing?: Partial<Record<MarketingChannel, boolean>>;
  /** false = stop every marketing channel at once ("unsubscribe from all marketing"). */
  marketingAll?: false;
  channels?: Array<{ channel: MarketingChannel; enabled: boolean }>;
  /** Local hours 0-23 applied to every channel; null clears the personal window (the market default applies). */
  quietHours?: { start: number; end: number } | null;
}

/**
 * The patient preference centre (web and app): purposes and channels with the separation the law and the product need. Transactional, security and
 * clinical messages are REQUIRED service messages (shown, not switchable here); reminders and each marketing channel are explicit, unticked-by-default
 * choices; analytics measurement is a separate consent; quiet hours and the marketing caps are visible. Every change goes through ConsentService (audit + event).
 */
@Injectable()
export class PreferenceCentreService {
  private defaults: ConsentDefaultsProvider = async () => FALLBACK_CONSENT_DEFAULTS;
  constructor(private readonly prisma: PrismaService, private readonly consents: ConsentService, private readonly suppression: SuppressionService, private readonly flags: FlagsService) {}
  setDefaultsProvider(fn: ConsentDefaultsProvider) { this.defaults = fn; this.consents.setTextVersionProvider(async (m) => (await fn(m)).textVersionIds); }
  consentDefaults(market = 'EG') { return this.defaults(market).catch(() => FALLBACK_CONSENT_DEFAULTS); }

  async get(sub: string, market = 'EG') {
    const d = await this.consentDefaults(market);
    const states = await this.consents.states(sub, ['REMINDERS', 'ANALYTICS_MEASUREMENT', ...MARKETING_CONSENT_PURPOSES]);
    const prefs = await this.prisma.notificationPreference.findMany({ where: { sub } });
    const profile = await this.prisma.patientProfile.findUnique({ where: { sub }, select: { phone: true, email: true } });
    const marketingOn = await this.flags.isEnabled('growth.marketing_messaging', { market }).catch(() => false);
    const channels = [];
    for (const channel of MARKETING_CHANNELS) {
      const st = states.get(`MARKETING_${channel}`)!;
      const pref = prefs.find((p) => p.channel === channel);
      const addr = channel === 'EMAIL' ? profile?.email : channel === 'PUSH' ? null : profile?.phone;
      channels.push({ channel, marketingConsent: st.granted, textVersion: st.version, updatedAt: st.updatedAt, channelEnabled: pref ? pref.enabled : true, suppressed: channel === 'PUSH' ? false : await this.suppression.isSuppressed([addr], channel, market), quietStart: pref?.quietStart ?? null, quietEnd: pref?.quietEnd ?? null });
    }
    return {
      version: 1,
      /** Wording is NEEDS_HUMAN: true while any text version is still the placeholder (clients show a visible draft marker outside production). */
      draftWording: [d.textVersionIds.analytics, d.textVersionIds.marketing].some((v) => v.startsWith('TODO_NEEDS_HUMAN')),
      textVersions: d.textVersionIds,
      serviceMessages: [
        { purpose: 'TRANSACTIONAL', required: true }, // booking confirmations, receipts
        { purpose: 'SECURITY', required: true }, // sign-in codes, new-device alerts
        { purpose: 'CLINICAL', required: true }, // care-critical: results ready, safety
      ],
      reminders: { consent: states.get('REMINDERS')!.granted, updatedAt: states.get('REMINDERS')!.updatedAt },
      analytics: { consent: states.get('ANALYTICS_MEASUREMENT')!.granted, textVersion: states.get('ANALYTICS_MEASUREMENT')!.version, updatedAt: states.get('ANALYTICS_MEASUREMENT')!.updatedAt },
      marketing: { available: marketingOn, anyConsent: channels.some((c) => c.marketingConsent), channels },
      quietHours: { start: prefs.find((p) => p.quietStart !== null)?.quietStart ?? null, end: prefs.find((p) => p.quietEnd !== null)?.quietEnd ?? null, defaultStart: hourOf(d.quietHoursStart), defaultEnd: hourOf(d.quietHoursEnd), timezone: d.quietHoursTimezone },
      caps: { perDay: d.maxMarketingPerDay, perWeek: d.maxMarketingPerWeek },
      withdrawalPropagationSeconds: d.withdrawalPropagationSeconds,
    };
  }

  async update(sub: string, u: PreferenceUpdate, o: { source?: string; ip?: string; market?: string } = {}) {
    const opts = { source: o.source ?? 'web', ip: o.ip };
    if (u.quietHours) {
      const { start, end } = u.quietHours;
      if (![start, end].every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) throw badRequest('INVALID_QUIET_HOURS', 'Quiet hours are whole hours 0-23');
    }
    if (u.marketingAll === false) for (const ch of MARKETING_CHANNELS) { if (await this.consents.hasConsent(sub, `MARKETING_${ch}`)) await this.consents.setConsent(sub, `MARKETING_${ch}`, false, { ...opts, evidence: 'unsubscribe_all' }); }
    for (const [ch, granted] of Object.entries(u.marketing ?? {})) {
      if (!(MARKETING_CHANNELS as readonly string[]).includes(ch)) throw badRequest('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|SMS|EMAIL|PUSH');
      if (typeof granted !== 'boolean') continue;
      if ((await this.consents.hasConsent(sub, `MARKETING_${ch}`)) !== granted) await this.consents.setConsent(sub, `MARKETING_${ch}`, granted, { ...opts, evidence: `pref_${ch.toLowerCase()}` });
      if (granted) { // a fresh opt-in lifts the person's own earlier STOP on this channel and turns the channel back on
        const p = await this.prisma.patientProfile.findUnique({ where: { sub }, select: { phone: true, email: true, market: true } });
        const lifted = await this.suppression.liftOwnOptOut(ch === 'EMAIL' ? [p?.email] : ch === 'PUSH' ? [] : [p?.phone], ch, p?.market ?? 'EG');
        if (lifted) await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel: ch } }, create: { sub, channel: ch, enabled: true }, update: { enabled: true } });
      }
    }
    if (typeof u.analytics === 'boolean' && (await this.consents.hasConsent(sub, 'ANALYTICS_MEASUREMENT')) !== u.analytics) await this.consents.setConsent(sub, 'ANALYTICS_MEASUREMENT', u.analytics, { ...opts, evidence: 'pref_analytics' });
    if (typeof u.reminders === 'boolean' && (await this.consents.hasConsent(sub, 'REMINDERS')) !== u.reminders) await this.consents.setConsent(sub, 'REMINDERS', u.reminders, { ...opts, evidence: 'pref_reminders' });
    for (const c of u.channels ?? []) {
      if (!(MARKETING_CHANNELS as readonly string[]).includes(c.channel)) throw badRequest('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|SMS|EMAIL|PUSH');
      await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel: c.channel } }, create: { sub, channel: c.channel, enabled: c.enabled }, update: { enabled: c.enabled } });
    }
    if (u.quietHours !== undefined) {
      const data = u.quietHours ? { quietStart: u.quietHours.start, quietEnd: u.quietHours.end } : { quietStart: null, quietEnd: null };
      for (const channel of MARKETING_CHANNELS) await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel } }, create: { sub, channel, ...data }, update: data });
    }
    return this.get(sub, o.market ?? 'EG');
  }
}
