import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KiorlyClient, KiorlyHttpError } from '../kiorly/kiorly-public';
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
  constructor(private readonly prisma: PrismaService, private readonly lab: NurseLabClient, private readonly kiorly: KiorlyClient, private readonly outbox: OutboxService) {}

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
    try {
      const { data } = await this.lab.createOrder(d.orderId, NurseLabRelayService.toInbound(d, vault));
      await this.prisma.nurseLabRelay.upsert({
        where: { id: d.orderId },
        create: { id: d.orderId, clinicId: d.clinicId, patientRef: d.patientRef, partnerOrderId: data.orderId, labOrderNumber: data.orderNumber, status: 'SUBMITTED', lastLabStatus: data.status },
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

  /** LabOrderStatusChanged (lab). The clinic learns every real step; RELEASED waits for LabResultReleased (it carries the report link). */
  async onStatusChanged(d: { orderId?: string; sourceRef?: string | null; nextStatus?: string }): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const r = await this.relayFor(d);
    if (!r) return 'UNKNOWN_ORDER';
    if (r.status === 'REFUSED' || !d.nextStatus || !RELAYED.has(d.nextStatus)) return 'IGNORED';
    await this.prisma.nurseLabRelay.update({ where: { id: r.id }, data: { lastLabStatus: d.nextStatus, ...(d.nextStatus === 'CANCELLED' ? { status: 'CANCELLED' } : {}) } });
    await this.enqueuePush(r.id, d.nextStatus, {});
    return 'APPLIED';
  }

  /** LabResultReleased (lab): the clinic gets the report id + secure link only (never values, KLCRIT03). */
  async onResultReleased(d: { orderId: string; reportId: string; reportVersion: number; signedAt: string; secureLink: string }): Promise<'APPLIED' | 'IGNORED' | 'UNKNOWN_ORDER'> {
    const r = await this.relayFor({ orderId: d.orderId });
    if (!r) return 'UNKNOWN_ORDER';
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
      const c = await this.custody(p.orderId); // transient lab failure throws: the outbox retries
      if (c) { body.custody = flatten(c); if (c.orderNumber) body.labOrderNumber = c.orderNumber; }
    }
    try {
      await this.kiorly.pushLabOrderStatus(p.orderId, body, r.clinicId);
    } catch (e) {
      if (e instanceof KiorlyHttpError && [404, 409, 422].includes(e.status)) { this.log.warn(`clinic refused lab status ${p.status} for ${p.orderId}: ${e.status} ${e.code ?? ''}`); return; } // permanent: do not retry
      throw e;
    }
  }

  private async custody(sourceRef: string): Promise<LabCustodyDto | null> {
    try { return (await this.lab.custody(sourceRef)).data; } catch (e) {
      if (e instanceof PartnerHttpError && e.status === 404) return null;
      throw e;
    }
  }

  /** What the nurse's clinic may see: custody events only, no names (the lab already strips them). */
  async custodyView(orderId: string) {
    const r = await this.prisma.nurseLabRelay.findUnique({ where: { id: orderId } });
    if (!r?.partnerOrderId) return null;
    const c = await this.custody(orderId);
    return c ? { orderId, status: c.status, orderNumber: c.orderNumber, custody: flatten(c) } : null;
  }
}

function flatten(c: LabCustodyDto) {
  return c.specimens.flatMap((s) => s.custody.map((e) => ({ label: s.label, type: e.type, occurredAt: e.occurredAt, by: e.by, temperatureC: e.temperatureC ?? null })));
}
