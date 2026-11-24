import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { ACQUISITION_ORIGINS, type AcquisitionBlock, type AcquisitionOrigin } from '@kiorex/contracts';
import { forbidden, badRequest } from '../../common/errors';
import { newId } from '../../common/ids';
import { subRefOf } from '../../common/privacy-hash';
import { FlagsService } from '../../control-plane/control-plane-public';
import { OutboxService } from '../../outbox/outbox-public';
import { ConsentService } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyAnyLinkToken } from '../consent/link-token';
import { LinkRegistryService } from '../links/link-registry.service';
import { FraudSignalService } from '../fraud/touch-rules';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { linkTokenKey, providerLinkTouchSecret } from '../growth-secrets';
import { decide, maxWindowMs, type Decision, type DecisionBooking, type DecisionPolicy, type DecisionTouch } from './decide';
import { AttributionPolicyResolver, toDecisionPolicy, type AttributionPolicyPayload } from './policy';

export const ATTRIBUTION_INTERNAL_EVENTS = ['AttributionAssigned', 'PatientAcquisitionRecorded'] as const;

export interface DecideForBookingInput {
  bookingId: string;
  /** The `kxv` cookie value read by the booking request (only when the person consented; the service double-checks withdrawal). */
  visitorKey?: string | null;
  /** The `lt` token the booking request carried (same session). */
  ltToken?: string | null;
  market?: string;
}
export interface StoredDecision { id: string; bookingId: string; origin: AcquisitionOrigin; reasonCode: string; policyVersionId: string; inputsHash: string; created: boolean }

const iso = (d: Date) => d.toISOString();
const asTouch = (t: { id: string; kind: string; providerOrgRef: string | null; occurredAt: Date; dwellMs: number | null }): DecisionTouch => ({ id: t.id, kind: t.kind, providerOrgRef: t.providerOrgRef, occurredAt: iso(t.occurredAt), dwellMs: t.dwellMs });

/**
 * Attribution core service (GRW-P1-B): gathers the facts, calls the PURE decide() and persists the immutable decision, once per (booking, policy version).
 * It never changes how much anyone pays: the Clinic reads the origin and can only REMOVE its fee for PROVIDER_LED (ARCH 6.4). Flag OFF
 * (`growth.attribution`) = no decision is made and the booking stays UNATTRIBUTED, exactly as before the engine existed.
 */
@Injectable()
export class AttributionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly policies: AttributionPolicyResolver, private readonly flags: FlagsService, private readonly outbox: OutboxService,
    // forwardRef: patient -> market -> growth (flag keys) -> patient is a file-level import cycle; the lazy reference resolves it
    @Inject(forwardRef(() => ConsentService)) private readonly consents: ConsentService, private readonly fraud: FraudSignalService, private readonly links: LinkRegistryService,
  ) {}

  /** Internal events have no consumer yet (analytics rollups in package J read the tables); a no-op handler keeps the outbox clean instead of dead-lettering them. */
  onModuleInit() { for (const t of ATTRIBUTION_INTERNAL_EVENTS) this.outbox.register(t, async () => undefined); }

  async decideForBooking(i: DecideForBookingInput): Promise<StoredDecision | null> {
    const market = i.market ?? GROWTH_DEFAULT_MARKET;
    const booking = await this.prisma.bookingIntent.findUnique({ where: { id: i.bookingId }, select: { id: true, sub: true, providerId: true, clinicId: true, clinicianId: true, tenantId: true, channel: true, createdAt: true } });
    if (!booking) throw growthError('GROWTH_EVIDENCE_NOT_FOUND', 'Booking not found');
    const orgId = booking.tenantId ?? (await this.prisma.provider.findUnique({ where: { id: booking.providerId }, select: { tenantId: true } }))?.tenantId ?? '';
    if (!(await this.flags.isEnabled(GROWTH_FLAG.ATTRIBUTION, { market, ...(orgId ? { orgId } : {}) }).catch(() => false))) return null;

    const { policy, payload } = await this.policies.decisionPolicy(market, booking.createdAt);
    const existing = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId: booking.id, policyVersionId: policy.versionId, supersedesId: null } });
    if (existing) return this.stored(existing, false);

    const touches = await this.touchesFor(booking, i.visitorKey ?? null, policy, market);
    const lt = i.ltToken ? verifyAnyLinkToken({ kxl1: linkTokenKey(), provider: providerLinkTouchSecret() }, i.ltToken, booking.createdAt.getTime()) : null;
    // a verified token proves its organisation; the code-to-organisation registry must not disagree (a code belongs to one organisation)
    const ltValid = !!(lt && lt.ok && orgId && lt.claims.org === orgId && (await this.links.learn(lt.claims.code, lt.claims.org, market)) !== 'CONFLICT');
    const input: DecisionBooking = { id: booking.id, orgId, clinicId: booking.clinicId, doctorId: booking.clinicianId, createdAt: iso(booking.createdAt), channel: booking.channel, ltValidForOrg: ltValid };
    const d = decide(input, touches.map(asTouch), policy);
    const row = await this.persist(booking.id, booking.sub, market, input, d, policy, payload, touches);
    if (row.created) await this.fraud.onDecision(orgId); // best effort and cheap; awaited so no query outlives the request
    return row;
  }

  private async touchesFor(b: { sub: string; createdAt: Date }, visitorKey: string | null, policy: DecisionPolicy, market: string) {
    const or: Array<{ visitorKey?: string; sub?: string }> = [{ sub: b.sub }];
    if (visitorKey) or.push({ visitorKey });
    const rows = await this.prisma.growthTouchpoint.findMany({
      where: { market, OR: or, occurredAt: { lt: b.createdAt, gte: new Date(b.createdAt.getTime() - maxWindowMs(policy)) } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 500,
    });
    // withdrawal stops visitor-linked processing: touches recorded before the person's latest analytics WITHDRAWAL are not used
    const last = await this.prisma.consentRecord.findFirst({ where: { sub: b.sub, purpose: 'ANALYTICS_MEASUREMENT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return last && !last.granted ? rows.filter((t) => t.occurredAt.getTime() > last.createdAt.getTime()) : rows;
  }

  private async persist(bookingId: string, sub: string, market: string, input: DecisionBooking, d: Decision, policy: DecisionPolicy, payload: AttributionPolicyPayload, touches: Array<{ id: string; kind: string }>): Promise<StoredDecision> {
    const kindOf = new Map(touches.map((t) => [t.id, t.kind]));
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const r = await tx.growthAttributionDecision.create({
          data: {
            market, bookingId, origin: d.origin, reasonCode: d.reasonCode, policyVersionId: policy.versionId, inputsHash: d.inputsHash, evidenceTouchIds: d.consideredTouchIds,
            firstTouchId: d.firstTouchId, lastTouchId: d.lastTouchId, lastNonDirectTouchId: d.lastNonDirectTouchId, winningTouchId: d.winningTouchId,
            bookingSnapshot: { booking: input, precedence: policy.precedence, policyPayload: payload } as never,
          },
        });
        await tx.bookingIntent.updateMany({ where: { id: bookingId, attributionDecisionId: null }, data: { acquisitionOrigin: d.origin, attributionDecisionId: r.id } });
        await this.outbox.enqueue(tx, { type: 'AttributionAssigned', aggregateType: 'BookingIntent', aggregateId: bookingId, payload: { bookingId, decisionId: r.id, origin: d.origin, reason: d.reasonCode, policyVersion: policy.versionId, market, decidedAt: r.createdAt.toISOString() }, dedupeKey: `AttributionAssigned:${r.id}` });
        const srcKind = d.winningTouchId ? kindOf.get(d.winningTouchId) ?? 'DIRECT' : input.channel === 'CLINIC_LINK' || input.ltValidForOrg ? 'PROVIDER_LINK' : 'DIRECT';
        // first time this person receives an acquisition origin (one per subject, whatever the booking)
        // ON CONFLICT DO NOTHING, not a caught unique violation: inside a transaction a failed statement would abort it and silently roll the decision back
        await tx.$executeRaw`INSERT INTO "OutboxEvent" ("id","type","aggregateType","aggregateId","target","payload","status","attempts","nextAttemptAt","dedupeKey","createdAt")
          VALUES (${newId('evt')}, 'PatientAcquisitionRecorded', 'Patient', ${subRefOf(sub)}, 'INTERNAL', ${JSON.stringify({ origin: d.origin, sourceKind: srcKind, market, recordedAt: r.createdAt.toISOString() })}::jsonb, 'PENDING', 0, now(), ${`PatientAcquisitionRecorded:${subRefOf(sub)}`}, now())
          ON CONFLICT ("dedupeKey") DO NOTHING`;
        return r;
      });
      return this.stored(row, true);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') { // a concurrent request wrote it first: the decision is unique per (booking, policy version)
        const won = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId, policyVersionId: policy.versionId, supersedesId: null } });
        if (won) return this.stored(won, false);
      }
      throw e;
    }
  }

  private stored(r: { id: string; bookingId: string; origin: string; reasonCode: string; policyVersionId: string; inputsHash: string }, created: boolean): StoredDecision {
    return { id: r.id, bookingId: r.bookingId, origin: r.origin as AcquisitionOrigin, reasonCode: r.reasonCode, policyVersionId: r.policyVersionId, inputsHash: r.inputsHash, created };
  }

  /** The newest decision of a booking (a correction supersedes the one it replaces). */
  async latest(bookingId: string) {
    const rows = await this.prisma.growthAttributionDecision.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
    return rows.filter((r) => !superseded.has(r.id)).pop() ?? null;
  }

  /** The additive `acquisition` block Kiorex sends to the Clinic on POST /marketplace/v1/bookings (contracts 1.10.0). Package C attaches it. */
  async acquisitionBlock(bookingId: string): Promise<AcquisitionBlock | null> {
    const d = await this.latest(bookingId);
    if (!d) return null;
    const winner = d.winningTouchId ? await this.prisma.growthTouchpoint.findUnique({ where: { id: d.winningTouchId }, select: { kind: true, linkCode: true, sourceId: true, occurredAt: true } }) : null;
    return { origin: d.origin as AcquisitionOrigin, decisionId: d.id, policyVersion: d.policyVersionId, reason: d.reasonCode, evidenceHash: d.inputsHash, ...(winner ? { touch: { kind: winner.kind, ref: winner.linkCode ?? winner.kind, at: iso(winner.occurredAt) } } : {}) };
  }

  /**
   * Authorised override (super admin only), appended as a NEW decision that supersedes the latest; nothing is edited. A correction may only REMOVE a fee
   * (toward PROVIDER_LED) or move between the two chargeable classes: PROVIDER_LED can never be turned into a chargeable origin (ARCH 6.4).
   */
  async correct(actor: { sub: string; roles: string[] }, bookingId: string, c: { origin: AcquisitionOrigin; note: string }) {
    if (!actor.roles.includes('super_admin')) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
    if (!(ACQUISITION_ORIGINS as readonly string[]).includes(c.origin)) throw badRequest('INVALID_ORIGIN', 'origin must be PROVIDER_LED, MARKETPLACE or UNATTRIBUTED');
    if (!c.note || c.note.trim().length < 10) throw badRequest('NOTE_REQUIRED', 'A reason of at least 10 characters is required for an override');
    const cur = await this.latest(bookingId);
    if (!cur) throw growthError('GROWTH_EVIDENCE_NOT_FOUND', 'No decision exists for this booking');
    if (cur.origin === 'PROVIDER_LED' && c.origin !== 'PROVIDER_LED') throw forbidden('CORRECTION_CANNOT_ADD_FEE', 'Evidence can only remove a fee, never add one: a provider-led decision cannot be turned into a chargeable one');
    if (cur.origin === c.origin) throw badRequest('NO_CHANGE', 'The decision already has this origin');
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.growthAttributionDecision.create({ data: { market: cur.market, bookingId, origin: c.origin, reasonCode: 'MANUAL_CORRECTION', policyVersionId: cur.policyVersionId, inputsHash: cur.inputsHash, evidenceTouchIds: cur.evidenceTouchIds, firstTouchId: cur.firstTouchId, lastTouchId: cur.lastTouchId, lastNonDirectTouchId: cur.lastNonDirectTouchId, winningTouchId: cur.winningTouchId, bookingSnapshot: cur.bookingSnapshot as never, supersedesId: cur.id, actor: actor.sub, note: c.note.trim().slice(0, 500) } });
      await tx.bookingIntent.updateMany({ where: { id: bookingId }, data: { acquisitionOrigin: c.origin, attributionDecisionId: r.id } });
      await tx.auditLog.create({ data: { actor: actor.sub, action: 'growth.attribution.correct', resource: 'GrowthAttributionDecision', resourceId: r.id, metadata: { bookingId, from: cur.origin, to: c.origin, supersedes: cur.id } as never } });
      await this.outbox.enqueue(tx, { type: 'AttributionAssigned', aggregateType: 'BookingIntent', aggregateId: bookingId, payload: { bookingId, decisionId: r.id, origin: c.origin, reason: 'MANUAL_CORRECTION', policyVersion: cur.policyVersionId, market: cur.market, decidedAt: r.createdAt.toISOString() }, dedupeKey: `AttributionAssigned:${r.id}` });
      return r;
    }).catch((e) => { if ((e as { code?: string }).code === 'P2002') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'The decision was corrected concurrently: reload and retry'); throw e; });
    return this.stored(row, true);
  }

  /**
   * Replays the pure function on the STORED inputs (booking snapshot, policy payload as it was, the stored touch rows) and compares with the stored decision.
   * `matches` is the determinism SLI (must be 100 %). A correction is a different thing and is skipped (its origin is a human's, not the function's).
   */
  async replay(decisionId: string) {
    const d = await this.prisma.growthAttributionDecision.findUnique({ where: { id: decisionId } });
    if (!d) throw growthError('GROWTH_EVIDENCE_NOT_FOUND', 'Decision not found');
    if (d.supersedesId || !d.bookingSnapshot) return { matches: true, skipped: true as const, reason: 'CORRECTION_OR_NO_SNAPSHOT' };
    const snap = d.bookingSnapshot as unknown as { booking: DecisionBooking; precedence: DecisionPolicy['precedence']; policyPayload: AttributionPolicyPayload };
    const touches = await this.prisma.growthTouchpoint.findMany({ where: { id: { in: d.evidenceTouchIds } } });
    const again = decide(snap.booking, touches.map(asTouch), toDecisionPolicy(d.policyVersionId, snap.policyPayload));
    const matches = again.origin === d.origin && again.reasonCode === d.reasonCode && again.inputsHash === d.inputsHash && (again.winningTouchId ?? null) === (d.winningTouchId ?? null);
    return { matches, skipped: false as const, stored: { origin: d.origin, reasonCode: d.reasonCode, inputsHash: d.inputsHash }, replayed: { origin: again.origin, reasonCode: again.reasonCode, inputsHash: again.inputsHash } };
  }
}
