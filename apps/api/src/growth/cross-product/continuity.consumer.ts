import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { cfg } from '../../common/config';
import { PatientService } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import type { CrossProductEventPort } from '../growth-ports-public';
import { recordGrowthFailure } from '../growth-failures';
import { CROSS_PRODUCT_FAILURE, CrossProductService } from './continuity.service';

type Env = { type: string; data?: Record<string, unknown> | null };
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);

/**
 * The only reader of Clinic events for the package. It reads the event TYPE and the IDS (patient reference, encounter or order id, clinic id, the signing time) and nothing else: `items`, `notes`,
 * `patient`, `soap` and every other field are never looked at, never copied and never logged. It creates the patient's own prompt state (a card may show) and nothing that leaves the patient's account.
 *  - `PRESCRIPTION_SHARED` -> a pharmacy prompt, only when the record exists in the patient's vault (the patient's record-share consent was honoured upstream);
 *  - `LabOrderPlaced` of the Clinic edition -> a lab prompt (the Nurse edition is relayed by its own path and is not a prompt);
 *  - `CARE_PLAN_CONFIRMED` and `MedicationOrderShared` are intentionally NOT used: a confirmed plan is already a downstream fact and a medication order already went to a pharmacy.
 * Never throws: it is called after the webhook was applied.
 */
@Injectable()
export class CrossProductConsumer implements CrossProductEventPort {
  private readonly log = new Logger('cross-product');
  constructor(private readonly prisma: PrismaService, private readonly cross: CrossProductService) {}

  async onKiorlyEvent(env: Env): Promise<{ offered: number }> {
    try {
      if (!(await this.cross.isOn())) return { offered: 0 };
      if (env.type === 'PRESCRIPTION_SHARED') return await this.onPrescription(env.data ?? {});
      if (env.type === 'LabOrderPlaced') return await this.onLabOrder(env.data ?? {});
      return { offered: 0 };
    } catch (e) { recordGrowthFailure(CROSS_PRODUCT_FAILURE.ENTRY); this.log.warn(`${CROSS_PRODUCT_FAILURE.ENTRY} ${env.type}: ${(e as Error).message}`); return { offered: 0 }; }
  }

  /** Subjects linked to a Kiorly patient id (their own accounts, never a dependant's link). */
  private subsOf(kiorlyPatientId: string) { return this.prisma.kiorlyPatientLink.findMany({ where: { kiorlyPatientId, status: 'LINKED', dependantId: null }, select: { sub: true } }); }

  private async onPrescription(d: Record<string, unknown>) {
    const patientId = str(d.patientId); const encounterId = str(d.encounterId); const clinicId = str(d.clinicId);
    if (!patientId || !encounterId) return { offered: 0 };
    const signedAt = typeof d.signedAt === 'string' && !Number.isNaN(Date.parse(d.signedAt)) ? new Date(d.signedAt) : new Date();
    let offered = 0;
    for (const l of await this.subsOf(patientId)) {
      const rec = await this.prisma.sharedRecord.findFirst({ where: { sub: l.sub, kind: 'PRESCRIPTION', sourceRef: encounterId, status: 'ACTIVE' }, select: { id: true } }); // not stored (vault off, scope revoked): no prompt
      if (!rec) continue;
      if (await this.cross.offer({ sub: l.sub, kind: 'RX_TO_PHARMACY', fact: encounterId, factKind: 'RX', at: signedAt, clinicId })) offered += 1;
    }
    return { offered };
  }

  private async onLabOrder(d: Record<string, unknown>) {
    if (d.originEdition === 'NURSE') return { offered: 0 };
    const patientRef = str(d.patientRef); const orderId = str(d.orderId); const clinicId = str(d.clinicId);
    if (!patientRef || !orderId) return { offered: 0 };
    const orderedAt = typeof d.orderedAt === 'string' && !Number.isNaN(Date.parse(d.orderedAt)) ? new Date(d.orderedAt) : new Date();
    let offered = 0;
    for (const l of await this.subsOf(patientRef)) if (await this.cross.offer({ sub: l.sub, kind: 'LAB_ORDER_TO_LAB', fact: orderId, factKind: 'LAB_ORDER', at: orderedAt, clinicId })) offered += 1;
    return { offered };
  }
}

/** Daily purge of expired prompt states (jobs enabled only). */
@Injectable()
export class CrossProductJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('cross-product-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly cross: CrossProductService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.cross.purgeExpired().catch((e) => this.log.warn(`cross-product purge failed: ${e.message}`)), 24 * 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

/** Subject erasure: the patient's prompt states go with them (the links hold no person). */
@Injectable()
export class CrossProductErasure implements OnModuleInit {
  constructor(@Inject(forwardRef(() => PatientService)) private readonly patients: PatientService, private readonly cross: CrossProductService) {}
  onModuleInit() {
    this.patients.registerAnonymizer('crossProduct', (sub) => this.cross.eraseSubject(sub));
    this.patients.registerExport('crossProduct', (sub) => this.cross.exportFor(sub)); // the patient's own prompt states (kind and dates; no hash, no content)
  }
}
