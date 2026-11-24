import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KiorlyClient, KiorlyHttpError } from '../kiorly/kiorly-public';
import { unavailable } from '../common/errors';
import { PartnerRegistry } from '../partners/partners-public';
import { LabClient } from './lab.client';
import { PartnerHttpError } from '../common/partner-http';
import { OutboxService } from '../outbox/outbox-public';
import { PrismaService } from '../prisma/prisma.service';
import { LabCustodyDto, NurseLabClient, NurseLabOrderIntent } from './nurse-lab.client';

/** `LabOrderPlaced.data` from Kiorly Clinic (NURSE edition, kiorex-contracts 1.6.0). Only the fields the relay reads. */
export interface NurseLabOrderPlaced {
  orderId: string; clinicId: string; patientRef: string; consentToken?: string; orderingClinicianId?: string; preferredLabId?: string;
  originEdition?: string; prescriberName?: string; identifiersChecked?: string[];
  items?: { code?: string; nameEn?: string }[];
  patient?: { fullName?: string; dateOfBirth?: string; sex?: 'M' | 'F' | 'OTHER' | 'UNKNOWN'; phone?: string; preferredLocale?: 'ar' | 'en' };
  nurseCollection?: { visitRef?: string; collectorRef?: string; collectorName?: string; collectedAt?: string; handedOverAt?: string; temperatureC?: number; samples?: { label: string; specimenType: string; container?: string }[] };
}

export type RelayOutcome = 'APPLIED' | 'DUPLICATE' | 'REFUSED' | 'IGNORED';
const PUSH = 'nurse_lab.status_push';
/** Lab order statuses the nurse's clinic is told about (DRAFT / AWAITING_COLLECTION add nothing after the ACCEPTED push; RELEASED needs the report link and arrives as LabResultReleased). */
const RELAYED = new Set(['COLLECTED', 'IN_LAB', 'PARTIALLY_RESULTED', 'AWAITING_VALIDATION', 'VALIDATED', 'CANCELLED']);

/**
 * KNLAB01 / KLORD05: Kiorex is the relay between Kiorly Nurse (an edition of Kiorly Clinic) and Kiorly Lab.
 *   LabOrderPlaced (Nurse) -> POST lab /orders with the KIORLY_NURSE client (idempotent on the clinic's order id) -> ACCEPTED/REJECTED_BY_LAB to the clinic.
 *   LabOrderStatusChanged / LabResultReleased (lab) -> status + sanitized custody (+ secure link) pushed to the clinic's connector, through the outbox.
 * Demographics, identifiers and tube labels are relayed and never stored here (only ids, statuses and the report id). A transient lab failure throws,
 * so the webhook answers 5xx and the clinic outbox redelivers with the same eventId; a definitive lab refusal is relayed to the clinic as REJECTED_BY_LAB.
 */
@Injectable()
export class NurseLabRelayService implements OnModuleInit {
  private readonly log = new Logger('nurse-lab');
  private readonly labIds = new Map<string, { at: number; ids: Set<string> }>();
  constructor(private readonly prisma: PrismaService, private readonly lab: NurseLabClient, private readonly kiorly: KiorlyClient, private readonly outbox: OutboxService, private readonly registry: PartnerRegistry, private readonly labs: LabClient) {}

  /** Lab ids one LAB registration serves (its test catalogue), cached for a minute; `refresh` bypasses the cache. */
  private async labIdsOf(labRegistrationId: string, refresh: boolean): Promise<Set<string>> {
    const hit = this.labIds.get(labRegistrationId);
    if (hit && !refresh && Date.now() - hit.at < 60_000) return hit.ids;
    const ids = new Set((await this.labs.tests({}, labRegistrationId)).data.items.map((t) => t.labId));
    this.labIds.set(labRegistrationId, { at: Date.now(), ids });
    return ids;
  }

  /**
   * Which LAB_NURSE registration serves this order (per-registration routing, like pharmacy and lab). 0 registrations: the env default (null). One nurse client and at most
   * one lab: that client (unchanged behaviour). Otherwise the order's `preferredLabId` is matched to the LAB registration that owns that lab, and the nurse client
   * paired with it (`labRegistrationId`) is used; an order that names no lab goes to the oldest nurse client. No owner or no paired client is a definitive refusal code;
   * a lab system that cannot be asked right now throws (5xx: the clinic redelivers).
   */
  async routeFor(preferredLabId?: string): Promise<{ registrationId: string | null } | { refusal: string }> {
    const nurse = await this.registry.activeRegistrations('LAB_NURSE');
    if (!nurse.length) return { registrationId: null };
    const labRegs = await this.registry.activeRegistrations('LAB');
    if (nurse.length === 1 && labRegs.length <= 1) return { registrationId: nurse[0]!.id };
    if (!preferredLabId) return { registrationId: nurse[0]!.id };
    for (const refresh of [false, true]) {
      const owners: string[] = []; let failed = 0;
      for (const l of labRegs) { try { if ((await this.labIdsOf(l.id, refresh)).has(preferredLabId)) owners.push(l.id); } catch { failed++; } }
      if (owners.length > 1) return { refusal: 'AMBIGUOUS_LAB' };
      if (owners.length === 1) { const n = nurse.find((x) => x.labRegistrationId === owners[0]); return n ? { registrationId: n.id } : { refusal: 'LAB_NURSE_NOT_REGISTERED' }; }
      if (refresh) { if (failed) throw unavailable('PARTNER_SYSTEM_BUSY', 'A lab system is busy, try again shortly', { retryable: true }); return { refusal: 'LAB_NOT_FOUND' }; }
    }
    return { refusal: 'LAB_NOT_FOUND' };
  }

  onModuleInit() { this.outbox.register(PUSH, (e) => this.deliverStatus(e.payload)); }

  /** Pure validation of what the lab will insist on, so the clinic gets a precise refusal code instead of a lab 4xx. */
  static refusal(d: NurseLabOrderPlaced): string | null {
    if (!d.consentToken?.trim()) return 'CONSENT_REQUIRED';
    if (!d.nurseCollection?.samples?.length || !d.nurseCollection.collectedAt || !d.nurseCollection.visitRef || !d.nurseCollection.collectorRef) return 'NURSE_COLLECTION_REQUIRED';
    if ((d.identifiersChecked ?? []).length < 2) return 'TWO_IDENTIFIERS_REQUIRED';
    if (!d.patient?.fullName || d.patient.fullName.trim().length < 2) return 'PATIENT_DEMOGRAPHICS_REQUIRED';
    if (!d.items?.length || d.items.some((i) => !i.code)) return 'ITEM_CODE_REQUIRED';
    return null;
  }

  /** Contract LabOrderPlaced (originEdition NURSE) -> the Lab's strict inbound order (source KIORLY_NURSE). */
  static toInbound(d: NurseLabOrderPlaced, vault: boolean): NurseLabOrderIntent {
    const c = d.nurseCollection!;
    const p = d.patient!;
    return {
      sourceRef: d.orderId,
      ...(d.preferredLabId ? { labId: d.preferredLabId } : {}),
      patient: { fullName: p.fullName!, ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}), ...(p.sex ? { sex: p.sex } : {}), ...(p.phone ? { phone: p.phone } : {}), ...(p.preferredLocale ? { preferredLocale: p.preferredLocale } : {}), externalId: d.patientRef },
      testCodes: d.items!.map((i) => i.code as string),
      priority: 'ROUTINE',
      ...(d.orderingClinicianId || d.prescriberName ? { referringDoctor: { ...(d.prescriberName ? { name: d.prescriberName } : {}), ...(d.orderingClinicianId ? { ref: d.orderingClinicianId } : {}) } } : {}),
      consentChannels: vault ? ['KIORLY_NURSE_IMPORT', 'KIOREX_VAULT'] : ['KIORLY_NURSE_IMPORT'],
      identifiersChecked: d.identifiersChecked!,
      nurseCollection: {
        visitRef: c.visitRef!, collectorRef: c.collectorRef!, ...(c.collectorName ? { collectorName: c.collectorName } : {}), collectedAt: c.collectedAt!,
        ...(c.handedOverAt ? { handedOverAt: c.handedOverAt } : {}), ...(c.temperatureC != null ? { temperatureC: c.temperatureC } : {}), consentToken: d.consentToken!,
        samples: c.samples!.map((s) => ({ label: s.label, specimenType: s.specimenType, ...(s.container ? { container: s.container } : {}) })),
      },
    };
  }

  /** Does the patient have a linked Kiorex vault, and has she not revoked LAB_RESULTS sharing there? */
  private async vaultState(patientRef: string): Promise<{ vault: boolean; revoked: boolean }> {
    const links = await this.prisma.kiorlyPatientLink.findMany({ where: { kiorlyPatientId: patientRef, status: 'LINKED' }, select: { sub: true } });
    if (!links.length) return { vault: false, revoked: false };
    const revoked = await this.prisma.recordShareConsent.count({ where: { sub: { in: links.map((l) => l.sub) }, scope: 'LAB_RESULTS', granted: false } });
    return { vault: !revoked, revoked: revoked > 0 };
  }

  async onOrderPlaced(d: NurseLabOrderPlaced): Promise<RelayOutcome> {
    if (d.originEdition !== 'NURSE') return 'IGNORED'; // Clinic-edition hand-offs have no Lab consumer yet (NH-026)
    const existing = await this.prisma.nurseLabRelay.findUnique({ where: { id: d.orderId } });
    if (existing) return 'DUPLICATE';
    const refusal = NurseLabRelayService.refusal(d);
    if (refusal) return this.refuse(d, refusal);
    const { vault, revoked } = await this.vaultState(d.patientRef);
    if (revoked) return this.refuse(d, 'CONSENT_REVOKED');
    const route = await this.routeFor(d.preferredLabId);
    if ('refusal' in route) return this.refuse(d, route.refusal);
    try {
      const { data } = await this.lab.createOrder(d.orderId, NurseLabRelayService.toInbound(d, vault), route.registrationId);
      await this.prisma.nurseLabRelay.upsert({
        where: { id: d.orderId },
        create: { id: d.orderId, clinicId: d.clinicId, patientRef: d.patientRef, partnerOrderId: data.orderId, registrationId: route.registrationId, labOrderNumber: data.orderNumber, status: 'SUBMITTED', lastLabStatus: data.status },
        update: {},
      });
      await this.enqueuePush(d.orderId, 'ACCEPTED', { labOrderNumber: data.orderNumber });
      return 'APPLIED';
    } catch (e) {
      if (e instanceof PartnerHttpError && e.status !== 401 && e.status !== 403) return this.refuse(d, e.code ?? `LAB_${e.status}`); // definitive refusal: never retried
      throw e; // 401/403 = our credentials or the lab flag: surface; transient errors: the clinic redelivers
    }
  }

  private async refuse(d: NurseLabOrderPlaced, code: string): Promise<RelayOutcome> {
    await this.prisma.nurseLabRelay.upsert({ where: { id: d.orderId }, create: { id: d.orderId, clinicId: d.clinicId, patientRef: d.patientRef, status: 'REFUSED', refusalCode: code.slice(0, 80) }, update: {} });
    await this.enqueuePush(d.orderId, 'REJECTED_BY_LAB', { rejectionCode: code });
    return 'REFUSED';
  }

  private async relayFor(ids: { orderId?: string; sourceRef?: string | null }) {
    return this.prisma.nurseLabRelay.findFirst({ where: { OR: [...(ids.sourceRef ? [{ id: ids.sourceRef }] : []), ...(ids.orderId ? [{ partnerOrderId: ids.orderId }, { id: ids.orderId }] : [])] } });
  }

  /** An event signed by lab registration X must not move an order that belongs to another lab: true (and audited) when the relay's nurse client is paired with a different lab registration. */
  private async foreign(r: { id: string; registrationId: string | null }, ctx: { registrationId?: string | null }, type: string): Promise<boolean> {
    if (!ctx.registrationId || !r.registrationId) return false;
    const owner = (await this.prisma.partnerRegistration.findUnique({ where: { id: r.registrationId }, select: { labRegistrationId: true } }))?.labRegistrationId;
    if (!owner || owner === ctx.registrationId) return false;
    await this.prisma.auditLog.create({ data: { actor: 'nurse_lab', action: 'nurse_lab.event_from_other_registration', resource: 'NurseLabRelay', resourceId: r.id, metadata: { type, from: ctx.registrationId, owner } } });
    return true;
  }

  /** LabOrderStatusChanged (lab). The clinic learns every real step; RELEASED waits for LabResultReleased (it carries the report link). */
  async onStatusChanged(d: { orderId?: string; sourceRef?: string | null; nextStatus?: string }, ctx: { registrationId?: string | null } = {}): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const r = await this.relayFor(d);
    if (!r) return 'UNKNOWN_ORDER';
    if (await this.foreign(r, ctx, 'LabOrderStatusChanged')) return 'IGNORED';
    if (r.status === 'REFUSED' || !d.nextStatus || !RELAYED.has(d.nextStatus)) return 'IGNORED';
    await this.prisma.nurseLabRelay.update({ where: { id: r.id }, data: { lastLabStatus: d.nextStatus, ...(d.nextStatus === 'CANCELLED' ? { status: 'CANCELLED' } : {}) } });
    await this.enqueuePush(r.id, d.nextStatus, {});
    return 'APPLIED';
  }

  /** LabResultReleased (lab): the clinic gets the report id + secure link only (never values, KLCRIT03). */
  async onResultReleased(d: { orderId: string; reportId: string; reportVersion: number; signedAt: string; secureLink: string }, ctx: { registrationId?: string | null } = {}): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const r = await this.relayFor({ orderId: d.orderId });
    if (!r) return 'UNKNOWN_ORDER';
    if (await this.foreign(r, ctx, 'LabResultReleased')) return 'IGNORED';
    if (r.status === 'REFUSED') return 'IGNORED';
    await this.prisma.nurseLabRelay.update({ where: { id: r.id }, data: { status: 'RESULT_RELEASED', lastLabStatus: 'RELEASED', reportId: d.reportId } });
    await this.enqueuePush(r.id, 'RELEASED', { reportId: d.reportId, reportVersion: d.reportVersion, signedAt: d.signedAt, secureLink: d.secureLink }, `${d.reportVersion}`);
    return 'APPLIED';
  }

  private enqueuePush(orderId: string, status: string, extra: Record<string, unknown>, discriminator = '') {
    return this.outbox.enqueue(this.prisma, { type: PUSH, aggregateType: 'NurseLabRelay', aggregateId: orderId, payload: { orderId, status, occurredAt: new Date().toISOString(), ...extra }, dedupeKey: `${PUSH}:${orderId}:${status}${discriminator ? `:${discriminator}` : ''}` });
  }

  /** Outbox handler: fetch the sanitized custody from the lab, then push the status to the clinic. Retries with backoff (same dedupe key). */
  async deliverStatus(p: { orderId: string; status: string; [k: string]: unknown }): Promise<void> {
    const r = await this.prisma.nurseLabRelay.findUnique({ where: { id: p.orderId } });
    if (!r) return;
    const body: Record<string, unknown> = { ...p };
    delete body.orderId;
    if (r.labOrderNumber) body.labOrderNumber = r.labOrderNumber;
    if (p.status !== 'REJECTED_BY_LAB' && r.partnerOrderId) {
      const c = await this.custody(p.orderId, r.registrationId); // transient lab failure throws: the outbox retries
      if (c) { body.custody = flatten(c); if (c.orderNumber) body.labOrderNumber = c.orderNumber; }
    }
    try {
      await this.kiorly.pushLabOrderStatus(p.orderId, body, r.clinicId);
    } catch (e) {
      if (e instanceof KiorlyHttpError && [404, 409, 422].includes(e.status)) { this.log.warn(`clinic refused lab status ${p.status} for ${p.orderId}: ${e.status} ${e.code ?? ''}`); return; } // permanent: do not retry
      throw e;
    }
  }

  private async custody(sourceRef: string, registrationId?: string | null): Promise<LabCustodyDto | null> {
    try { return (await this.lab.custody(sourceRef, registrationId)).data; } catch (e) {
      if (e instanceof PartnerHttpError && e.status === 404) return null;
      throw e;
    }
  }

  /** What the nurse's clinic may see: custody events only, no names (the lab already strips them). */
  async custodyView(orderId: string) {
    const r = await this.prisma.nurseLabRelay.findUnique({ where: { id: orderId } });
    if (!r?.partnerOrderId) return null;
    const c = await this.custody(orderId, r.registrationId);
    return c ? { orderId, status: c.status, orderNumber: c.orderNumber, custody: flatten(c) } : null;
  }
}

function flatten(c: LabCustodyDto) {
  return c.specimens.flatMap((s) => s.custody.map((e) => ({ label: s.label, type: e.type, occurredAt: e.occurredAt, by: e.by, temperatureC: e.temperatureC ?? null })));
}
