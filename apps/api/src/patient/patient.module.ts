import { Global, Module } from '@nestjs/common';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { ConsentService } from './consent/consent.service';
import { PreferenceCentreService } from './consent/preference-centre.service';
import { SuppressionService } from './consent/suppression.service';
import { PreferenceCentreController } from './consent/preference-centre.controller';

@Global()
@Module({ controllers: [PatientController, PreferenceCentreController], providers: [PatientService, ConsentService, PreferenceCentreService, SuppressionService], exports: [PatientService, ConsentService, PreferenceCentreService, SuppressionService] })
export class PatientModule {}
