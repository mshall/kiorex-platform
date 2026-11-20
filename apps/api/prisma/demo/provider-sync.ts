/**
 * Kiorex provider sync as a compiled one-shot (Q10 Part B): pulls the live providers (incl. the demo clinics / Nurse providers) from Kiorly Clinic
 * over the signed marketplace API, exactly what `POST /admin/providers/sync?full=true` does in the ops console. Runs between the Kiorly seeds and
 * the Kiorex demo seed (seed-staging.sh step 5; the local equivalent is scripts/ops-sync.mjs). Needs KIORLY_BASE_URL / KIORLY_CLIENT_KEY /
 * KIORLY_CLIENT_SECRET (the API's own settings) and an egress path to Kiorly Clinic (HB07). Non-production only (same guard as the demo seed).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { CatalogService } from '../../src/catalog/catalog.service';
import { assertDemoSeedAllowed } from '../../src/common/demo-seed-guard';

async function main() {
  assertDemoSeedAllowed('Kiorex provider sync (from Kiorly Clinic)');
  process.env.JOBS_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const r = await app.get(CatalogService).syncOnce({ full: true });
    console.log(`Kiorex provider sync: ${JSON.stringify(r)}`);
    if (!r.upserted && !r.skipped) throw new Error('provider sync returned no providers: is Kiorly Clinic seeded and reachable?');
  } finally { await app.close(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
