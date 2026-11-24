import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { OutboxService } from '../../outbox/outbox-public';
import { PreferenceCentreService, type ConsentDefaults } from '../../patient/patient-public';
import { GrowthConfigService } from '../config/growth-config.service';

/**
 * Connects the patient module's consent services to the versioned CONSENT_DEFAULTS growth config WITHOUT the patient module importing growth: the
 * preference centre, the consent text versions and the marketing send gate all read the same ACTIVE version (else PROPOSED_DEFAULT). Also gives the
 * internal `PatientConsentUpdated` event a consumer so the outbox never dead-letters it.
 */
@Injectable()
export class ConsentWiring implements OnModuleInit {
  constructor(@Inject(forwardRef(() => PreferenceCentreService)) private readonly prefs: PreferenceCentreService, private readonly config: GrowthConfigService, private readonly outbox: OutboxService) {}
  onModuleInit() {
    this.prefs.setDefaultsProvider(async (market) => (await this.config.resolve<ConsentDefaults>('CONSENT_DEFAULTS', { market })).payload);
    this.outbox.register('PatientConsentUpdated', async () => undefined); // history and gate read the database directly; the event is for analytics and audit consumers
  }
}
