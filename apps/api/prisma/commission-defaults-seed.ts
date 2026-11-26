/** Installs only the recommended commission defaults (COM-4), without the rest of the dev seed. Idempotent; never overwrites an operator row; never touches the counsel sign-off. */
import 'reflect-metadata';
import { createPrismaClient } from '../src/prisma/client-factory';
import { defaultsSeedEnabled, installCommissionDefaults } from '../src/commissions/commission-defaults';
import { checksumOf } from '../src/growth/config/growth-config.service';

async function main() {
  const prisma = createPrismaClient();
  if (!defaultsSeedEnabled()) console.log('COMMISSION_DEFAULTS_SEED=false: nothing installed');
  else console.log(JSON.stringify(await installCommissionDefaults(prisma as never, checksumOf)));
  await prisma.$disconnect();
}
void main();
