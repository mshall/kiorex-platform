import { Module } from '@nestjs/common';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { IMPORT_TARGET, KiorlyImportTarget, LocalStagingStore, MockImportTarget, STAGING_STORE } from './adapters';
import { MALWARE_SCANNER, MockMalwareScanner } from './lib/file-scan';
import { OnboardingImportController } from './onboarding-import.controller';
import { OnboardingImportService } from './onboarding-import.service';

/** IMPORT_TARGET_MODE=mock|kiorly (default mock, CLAUDE.md provider rule). Staging store + malware scanner are adapters too (S3 + GuardDuty/ClamAV at go-live). */
@Module({
  controllers: [OnboardingImportController],
  providers: [
    OnboardingImportService, MockImportTarget,
    { provide: STAGING_STORE, useClass: LocalStagingStore },
    { provide: MALWARE_SCANNER, useClass: MockMalwareScanner },
    { provide: IMPORT_TARGET, inject: [KiorlyClient, MockImportTarget], useFactory: (k: KiorlyClient, m: MockImportTarget) => (process.env.IMPORT_TARGET_MODE === 'kiorly' ? new KiorlyImportTarget(k) : m) },
  ],
})
export class OnboardingImportModule {}
