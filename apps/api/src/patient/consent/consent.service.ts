import { Injectable } from '@nestjs/common';
import { badRequest } from '../../common/errors';
import { ipHashOf, subRefOf } from '../../common/privacy-hash';
import { OutboxService } from '../../outbox/outbox-public';
import { PrismaService } from '../../prisma/prisma.service';

/** Consent purposes. The first five are the Rev 2.2 consent centre; the rest are the growth additions (ARCH section 9). */
export const CORE_CONSENT_PURPOSES = ['MARKETPLACE_PROCESSING', 'REMINDERS', 'RECORD_SHARING', 'AI_PROCESSING', 'VISIT_STATUS_SHARING'] as const;
export const MARKETING_CONSENT_PURPOSES = ['MARKETING_WHATSAPP', 'MARKETING_SMS', 'MARKETING_EMAIL', 'MARKETING_PUSH'] as const;
export const GROWTH_CONSENT_PURPOSES = ['ANALYTICS_MEASUREMENT', ...MARKETING_CONSENT_PURPOSES] as const;
export const ALL_CONSENT_PURPOSES = [...CORE_CONSENT_PURPOSES, ...GROWTH_CONSENT_PURPOSES] as const;
export type AnyConsentPurpose = (typeof ALL_CONSENT_PURPOSES)[number];
export const CONSENT_SOURCES = ['web', 'app', 'whatsapp', 'widget', 'ops-import'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
/** NEEDS_HUMAN: wording is legal text. Until counsel approves it every record carries this placeholder id (and the UI shows a visible draft marker outside production). */
export const CONSENT_TEXT_PLACEHOLDER = 'TODO_NEEDS_HUMAN_v0';

export interface SetConsentOpts { source?: string; textVersion?: string; ip?: string; evidence?: string }

/** Resolved text-version ids per consent family (from the CONSENT_DEFAULTS growth config; set by the growth module so this module never imports it). */
export type TextVersionProvider = (market: string) => Promise<{ analytics: string; marketing: string } | null>;

/**
 * Append-only consent history (GRW-P1-I). `hasConsent` reads the LATEST row per purpose straight from the database, so a withdrawal is effective for
 * the next send decision immediately (SLO: within 60 s). Every change writes the audit row (`ConsentRecord`: textVersion, source, at, ipHash, evidence)
 * and a `PatientConsentUpdated` internal outbox event in the SAME transaction, so history and event can never disagree.
 */
@Injectable()
export class ConsentService {
  private textVersions: TextVersionProvider = async () => null;
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  setTextVersionProvider(fn: TextVersionProvider) { this.textVersions = fn; }

  channelOf(purpose: string): string | null { return (MARKETING_CONSENT_PURPOSES as readonly string[]).includes(purpose) ? purpose.slice('MARKETING_'.length) : null; }

  async textVersionFor(purpose: string, market = 'EG'): Promise<string> {
    const v = await this.textVersions(market).catch(() => null);
    if (!v) return CONSENT_TEXT_PLACEHOLDER;
    return purpose === 'ANALYTICS_MEASUREMENT' ? v.analytics : (MARKETING_CONSENT_PURPOSES as readonly string[]).includes(purpose) ? v.marketing : CONSENT_TEXT_PLACEHOLDER;
  }

  async setConsent(sub: string, purpose: string, granted: boolean, o: SetConsentOpts = {}) {
    if (!(ALL_CONSENT_PURPOSES as readonly string[]).includes(purpose)) throw badRequest('UNKNOWN_CONSENT_PURPOSE', 'Unknown consent purpose', { allowed: ALL_CONSENT_PURPOSES });
    const source = (o.source ?? 'app').slice(0, 32); // internal callers (booking confirm, kiorly sync) pass their own label; the HTTP layer restricts it to CONSENT_SOURCES
    const eventSource = (CONSENT_SOURCES as readonly string[]).includes(source) ? source : 'app'; // the event contract allows web, app, whatsapp, widget, ops-import
    const textVersion = (o.textVersion && o.textVersion.length <= 64 ? o.textVersion : null) ?? (await this.textVersionFor(purpose));
    const at = new Date();
    await this.prisma.$transaction(async (tx) => {
      const channel = this.channelOf(purpose);
      await tx.consentRecord.create({ data: { sub, purpose, granted, version: textVersion, source, channel, ipHash: o.ip ? ipHashOf(o.ip, at) : null, evidence: o.evidence?.slice(0, 64) } });
      await this.outbox.enqueue(tx, {
        type: 'PatientConsentUpdated', aggregateType: 'PatientConsent', aggregateId: subRefOf(sub),
        payload: { subRef: subRefOf(sub), purpose, ...(channel ? { channel } : {}), granted, textVersion, source: eventSource, at: at.toISOString() },
      });
    });
    return { purpose, granted };
  }

  async hasConsent(sub: string, purpose: string): Promise<boolean> {
    const last = await this.prisma.consentRecord.findFirst({ where: { sub, purpose }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return !!last?.granted;
  }

  /** Latest state of many purposes in one query. */
  async states(sub: string, purposes: readonly string[]): Promise<Map<string, { granted: boolean; version: string | null; updatedAt: Date | null }>> {
    const rows = await this.prisma.consentRecord.findMany({ where: { sub, purpose: { in: [...purposes] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const out = new Map<string, { granted: boolean; version: string | null; updatedAt: Date | null }>();
    for (const p of purposes) { const r = rows.find((x) => x.purpose === p); out.set(p, { granted: !!r?.granted, version: r?.version ?? null, updatedAt: r?.createdAt ?? null }); }
    return out;
  }

  /** Marketing consent for ONE channel. In-app marketing (inbox) rides the push consent. */
  hasMarketingConsent(sub: string, channel: string) { return this.hasConsent(sub, `MARKETING_${channel === 'INAPP' ? 'PUSH' : channel}`); }

  history(sub: string, take = 200) { return this.prisma.consentRecord.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take }); }
}
