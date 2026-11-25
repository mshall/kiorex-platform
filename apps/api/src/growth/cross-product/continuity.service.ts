import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { ConsentService, CONSENT_TEXT_PLACEHOLDER } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { recordGrowthFailure } from '../growth-failures';
import { factRef } from './continuity-refs';
import { ENTRY_META, FLAG_CROSS_PRODUCT, asClinicOrigin, entryKindOfProduct, evaluateContinuity, lagHoursBetween, pickParent, type ContinuityEntryKind, type ContinuityProduct } from './continuity-rules';

export const CROSS_PRODUCT_CONSENT = 'CROSS_PRODUCT_CONTINUITY';
export const CROSS_PRODUCT_FAILURE = { LINK: 'growth.cross_product.link_failed', ENTRY: 'growth.cross_product.entry_failed' } as const;
const DAY = 86_400_000;

export interface ContinuityHint { entryId?: string | null; recordId?: string | null }
export interface ResolvedContinuity { entryId: string | null; kind: ContinuityEntryKind; parentBookingId: string; parentStartsAt: Date }
export interface ContinuityCard { id: string; kind: ContinuityEntryKind; toProduct: ContinuityProduct; expiresAt: string; /** the patient's own prescription record, for the pharmacy card only */ recordId?: string; path: string }

/**
 * Cross-product journeys (GRW-P4-A): the patient's own continuity cards, the consent for the measurement link, the entry points that the product decision follows and the append-only link.
 * Measurement and gentle in-app prompts only: nothing here sends a message, creates a reward or reads clinical content. Items, test names, diagnoses and specialty are never read or stored.
 */
@Injectable()
export class CrossProductService {
  private readonly log = new Logger('cross-product');
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, @Inject(forwardRef(() => ConsentService)) private readonly consents: ConsentService) {}

  /** `growth.cross_product` is launch-locked: effective only with gate evidence recorded by a human. A flag-check error counts as OFF (a prompt is never worth a failure). */
  async isOn(market = GROWTH_DEFAULT_MARKET): Promise<boolean> { try { return await this.flags.isEnabled(FLAG_CROSS_PRODUCT, { market }); } catch { return false; } }
  private async gatesOpen(kind: ContinuityEntryKind, market: string): Promise<boolean> {
    for (const k of ENTRY_META[kind].gateFlags) { if (!(await this.flags.isEnabled(k, { market }).catch(() => false))) return false; }
    return true;
  }

  // ───────────── consent (append-only history in ConsentRecord; withdrawal is effective for the next decision) ─────────────

  async consentState(sub: string) {
    const s = (await this.consents.states(sub, [CROSS_PRODUCT_CONSENT])).get(CROSS_PRODUCT_CONSENT)!;
    return { granted: s.granted, textVersion: s.version, updatedAt: s.updatedAt?.toISOString() ?? null, /** the wording is legal text and awaits counsel (NEEDS_HUMAN) */ draftWording: !s.version || s.version === CONSENT_TEXT_PLACEHOLDER };
  }
  async setConsent(sub: string, granted: boolean, source: string) {
    await this.consents.setConsent(sub, CROSS_PRODUCT_CONSENT, granted, { source });
    if (!granted) await this.prisma.crossProductEntryPoint.updateMany({ where: { sub, consumedAt: null }, data: { dismissedAt: new Date() } }); // withdrawn: no pending prompt keeps a link alive
    return this.consentState(sub);
  }

  // ───────────── entry points (the patient's own prompt state) ─────────────

  /** Creates the prompt state once per (person, kind, fact). Never throws into the caller (a failed prompt is counted and the clinical flow is untouched). */
  async offer(i: { sub: string; kind: ContinuityEntryKind; fact: string; factKind: Parameters<typeof factRef>[0]; at: Date; clinicId?: string | null; parentBookingId?: string | null; /** the parent was named by the Clinic's appointmentId (contracts 1.13.0) */ hinted?: boolean }, market = GROWTH_DEFAULT_MARKET): Promise<string | null> {
    try {
      const meta = ENTRY_META[i.kind];
      const parent = i.parentBookingId !== undefined ? i.parentBookingId : await this.parentFor(i.sub, i.at, meta.lookbackDays, i.clinicId);
      const ref = factRef(i.factKind, i.fact);
      const expiresAt = new Date(Math.max(i.at.getTime(), Date.now()) + meta.ttlDays * DAY);
      const row = await this.prisma.crossProductEntryPoint.upsert({ where: { sub_kind_factRef: { sub: i.sub, kind: i.kind, factRef: ref } }, create: { market, sub: i.sub, kind: i.kind, factRef: ref, parentBookingId: parent, parentHinted: !!i.hinted, expiresAt }, update: {} });
      return row.id;
    } catch (e) { recordGrowthFailure(CROSS_PRODUCT_FAILURE.ENTRY); this.log.warn(`${CROSS_PRODUCT_FAILURE.ENTRY} kind=${i.kind}: ${(e as Error).message}`); return null; }
  }

  /** The patient's own attended clinic booking that a share at `at` follows (never a dependant's booking). */
  async parentFor(sub: string, at: Date, lookbackDays: number, clinicId?: string | null): Promise<string | null> {
    const rows = await this.prisma.bookingIntent.findMany({ where: { sub, dependantId: null, status: { in: ['COMPLETED', 'CHECKED_IN'] }, startsAt: { gte: new Date(at.getTime() - lookbackDays * DAY), lte: new Date(at.getTime() + DAY) } }, select: { id: true, clinicId: true, startsAt: true, status: true, dependantId: true }, orderBy: { startsAt: 'desc' }, take: 20 });
    return pickParent(rows, { at, lookbackDays, clinicId })?.id ?? null;
  }

  async dismiss(sub: string, id: string) {
    const r = await this.prisma.crossProductEntryPoint.updateMany({ where: { id, sub, dismissedAt: null }, data: { dismissedAt: new Date() } });
    return { dismissed: r.count > 0 };
  }

  /**
   * The cards the patient may see now: only for the patient's own data, only with the package flag effective AND the gate of the destination product open, hidden once used, dismissed,
   * expired or when the clinical share was revoked. Reading creates the home-visit prompt for a recent attended visit (idempotent): the card follows a visit, it says nothing about its content.
   */
  async cards(sub: string, market = GROWTH_DEFAULT_MARKET): Promise<{ enabled: boolean; consent: boolean; cards: ContinuityCard[] }> {
    const consent = (await this.consentState(sub)).granted;
    if (!(await this.isOn(market))) return { enabled: false, consent, cards: [] };
    if (await this.gatesOpen('CARE_PLAN_TO_HOME_VISIT', market)) await this.ensureHomePrompt(sub, market);
    const now = new Date();
    const rows = await this.prisma.crossProductEntryPoint.findMany({ where: { sub, expiresAt: { gt: now }, consumedAt: null, dismissedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 });
    const cards: ContinuityCard[] = [];
    for (const r of rows) {
      const kind = r.kind as ContinuityEntryKind; const meta = ENTRY_META[kind];
      if (!meta || !(await this.gatesOpen(kind, market))) continue;
      let recordId: string | undefined;
      if (kind === 'RX_TO_PHARMACY') {
        const rec = await this.activePrescriptionFor(sub, r.factRef);
        if (!rec) continue; // revoked or gone: the prompt disappears with the share
        if (await this.prisma.pharmacyOrder.findFirst({ where: { sub, prescriptionRecordId: rec }, select: { id: true } })) continue; // already sent to a pharmacy
        recordId = rec;
      }
      cards.push({ id: r.id, kind, toProduct: meta.toProduct, expiresAt: r.expiresAt.toISOString(), ...(recordId ? { recordId } : {}), path: meta.cta });
    }
    return { enabled: true, consent, cards };
  }

  private async ensureHomePrompt(sub: string, market: string) {
    const meta = ENTRY_META.CARE_PLAN_TO_HOME_VISIT;
    const visit = await this.prisma.bookingIntent.findFirst({ where: { sub, dependantId: null, status: 'COMPLETED', startsAt: { gte: new Date(Date.now() - meta.lookbackDays * DAY) } }, orderBy: { startsAt: 'desc' }, select: { id: true, startsAt: true } });
    if (visit) await this.offer({ sub, kind: 'CARE_PLAN_TO_HOME_VISIT', fact: visit.id, factKind: 'CLINIC_BOOKING', at: visit.startsAt, parentBookingId: visit.id }, market);
  }

  /** Finds the patient's ACTIVE prescription record whose encounter hashes to `ref`. Content is never read (only `id` and `sourceRef`). */
  private async activePrescriptionFor(sub: string, ref: string): Promise<string | null> {
    const recs = await this.prisma.sharedRecord.findMany({ where: { sub, kind: 'PRESCRIPTION', status: 'ACTIVE' }, select: { id: true, sourceRef: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return recs.find((r) => r.sourceRef && factRef('RX', r.sourceRef) === ref)?.id ?? null;
  }

  // ───────────── resolution and the link (called by the product decision) ─────────────

  /**
   * Does this downstream fact follow a continuity entry point of the patient's own clinic booking? Returns the parent booking, or null (independent decision) when the package flag is OFF or locked,
   * the patient has not consented, the entry is not theirs, expired, dismissed or has no parent. A forged `entryId` or `recordId` of another person resolves to null.
   */
  async resolve(f: { product: ContinuityProduct; sub: string; createdAt: Date }, hint: ContinuityHint, market = GROWTH_DEFAULT_MARKET): Promise<ResolvedContinuity | null> {
    if (!hint.entryId && !hint.recordId) return null;
    if (!(await this.isOn(market))) return null;
    if (!(await this.consentState(f.sub)).granted) return null;
    const kind = entryKindOfProduct(f.product);
    const now = new Date();
    let entry = hint.entryId ? await this.prisma.crossProductEntryPoint.findFirst({ where: { id: hint.entryId, sub: f.sub, kind, expiresAt: { gt: now }, dismissedAt: null } }) : null;
    let parentBookingId = entry?.parentBookingId ?? null;
    if (!entry && hint.recordId && kind === 'RX_TO_PHARMACY') {
      // the prescription attached to the order is the entry point: the patient's own ACTIVE prescription record, its encounter hashed (the prompt state may not exist yet)
      const rec = await this.prisma.sharedRecord.findFirst({ where: { id: hint.recordId, sub: f.sub, kind: 'PRESCRIPTION', status: 'ACTIVE' }, select: { sourceRef: true, clinicId: true, signedAt: true, createdAt: true } });
      if (!rec?.sourceRef) return null;
      entry = await this.prisma.crossProductEntryPoint.findFirst({ where: { sub: f.sub, kind, factRef: factRef('RX', rec.sourceRef), expiresAt: { gt: now }, dismissedAt: null } });
      parentBookingId = entry ? (entry.parentHinted ? entry.parentBookingId : entry.parentBookingId ?? (await this.parentFor(f.sub, rec.signedAt ?? rec.createdAt, ENTRY_META.RX_TO_PHARMACY.lookbackDays, rec.clinicId))) : (await this.parentFor(f.sub, rec.signedAt ?? rec.createdAt, ENTRY_META.RX_TO_PHARMACY.lookbackDays, rec.clinicId));
    }
    if (hint.entryId && !entry) return null;
    if (!parentBookingId) return null;
    const parent = await this.prisma.bookingIntent.findFirst({ where: { id: parentBookingId, sub: f.sub, dependantId: null }, select: { id: true, startsAt: true } });
    if (!parent) return null;
    return { entryId: entry?.id ?? null, kind, parentBookingId: parent.id, parentStartsAt: parent.startsAt };
  }

  /**
   * The verdict and the append-only link of one decided downstream fact. Idempotent per downstream fact (unique key); a failure is counted and logged and never reaches the order or the booking.
   * Returns the rule verdict so the decision can take the origin. Rule 4 is structural: nothing in this class touches rewards, credit or referral tables.
   */
  verdict(own: { origin: string }, parent: { origin: string } | null) {
    return evaluateContinuity({ flagOn: true, consent: true, hasParent: !!parent, ownOrigin: own.origin, parentOrigin: parent?.origin ?? null });
  }

  async recordLink(i: { cont: ResolvedContinuity; product: ContinuityProduct; factId: string; factCreatedAt: Date; decision: { id: string; origin: string }; parent: { decisionId: string; origin: string }; market?: string }): Promise<boolean> {
    try {
      const v = this.verdict(i.decision, { origin: i.parent.origin });
      if (!v.linked) return false;
      try {
        await this.prisma.crossProductContinuity.create({ data: {
          market: i.market ?? GROWTH_DEFAULT_MARKET, toProduct: i.product, entryPoint: i.cont.kind, fromFactRef: factRef('CLINIC_BOOKING', i.cont.parentBookingId), toFactRef: factRef(i.product === 'PHARMACY' ? 'PHARMACY_ORDER' : i.product === 'LAB' ? 'LAB_BOOKING' : 'CARE_PLAN', i.factId),
          decisionId: i.decision.id, parentDecisionId: i.parent.decisionId, parentOrigin: asClinicOrigin(i.parent.origin), toOrigin: i.decision.origin, lagHours: lagHoursBetween(i.cont.parentStartsAt, i.factCreatedAt),
        } });
      } catch (e) { if ((e as { code?: string }).code !== 'P2002') throw e; } // the same downstream fact twice is one row
      if (i.cont.entryId) await this.prisma.crossProductEntryPoint.updateMany({ where: { id: i.cont.entryId, consumedAt: null }, data: { consumedAt: new Date() } });
      return true;
    } catch (e) { recordGrowthFailure(CROSS_PRODUCT_FAILURE.LINK); this.log.error(`${CROSS_PRODUCT_FAILURE.LINK} product=${i.product} (the ${i.product.toLowerCase()} fact continues): ${(e as Error).message}`, (e as Error).stack); return false; }
  }

  // ───────────── retention and erasure ─────────────

  /** Hard purge of prompt states 60 days after they expired (the links are keyed hashes and stay as the measurement record). */
  async purgeExpired(now = new Date()): Promise<{ purged: number }> {
    const r = await this.prisma.crossProductEntryPoint.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * DAY) } } });
    return { purged: r.count };
  }
  async exportFor(sub: string) {
    const rows = await this.prisma.crossProductEntryPoint.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 200, select: { kind: true, createdAt: true, expiresAt: true, consumedAt: true, dismissedAt: true } });
    return { consent: await this.consentState(sub), prompts: rows };
  }
  /** `subject.deleted`: the prompt states of the person go. The links hold no person (keyed hashes only), so they stay as aggregate evidence like the decisions they cite. */
  async eraseSubject(sub: string): Promise<{ entryPointsDeleted: number }> {
    const r = await this.prisma.crossProductEntryPoint.deleteMany({ where: { sub } });
    return { entryPointsDeleted: r.count };
  }
}
