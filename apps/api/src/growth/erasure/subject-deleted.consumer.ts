import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { PatientService } from '../../patient/patient-public';
import { GrowthMaintenanceService } from '../maintenance/growth-maintenance.service';

/**
 * `subject.deleted` (Passport back-channel logout, or the in-app deletion): the patient module runs every registered anonymiser for the subject, and this is
 * the growth one. It deletes the subject's touches and linked visitor keys with their funnel events through `growth_erase_subject` (touches a decision cites
 * as commission evidence are anonymised instead, because the provider's financial record outlives the person; the decision itself holds no personal data).
 * The function writes the AuditLog row (it stores sha256(sub), never the sub).
 */
@Injectable()
export class SubjectDeletedConsumer implements OnModuleInit {
  private readonly log = new Logger('growth-erasure');
  constructor(@Inject(forwardRef(() => PatientService)) private readonly patients: PatientService, private readonly maintenance: GrowthMaintenanceService) {}
  onModuleInit() {
    this.patients.registerAnonymizer('growth', async (sub) => {
      const r = await this.maintenance.eraseSubject(sub);
      this.log.log(`erased growth data: touches deleted ${r.touchpointsDeleted}, anonymised ${r.touchpointsAnonymised}, events ${r.eventsDeleted}`);
      return r;
    });
  }
}
