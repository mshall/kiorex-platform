/**
 * Demo data removal (founder request: "remove the dummy records, keep the real ones").
 *
 *   npm run demo-data:remove -- --dry-run          DEFAULT. Counts what would go, per table. Writes nothing.
 *   npm run demo-data:remove -- --confirm          deletes exactly the rows registered in "DemoMarker" (and their dependent children), in ONE transaction.
 *   npm run demo-data:remove -- --mark             one-time backfill: registers the rows the demo seed created (a database seeded before the marker existed).
 *                                                  The seed itself marks as it goes, so you only need this once on an old database.
 *
 * Real rows are never selected: removal reads the marker table only (no id pattern, no date, no tenant). Safe to repeat (idempotent).
 * Flags: --dry-run and --confirm together are refused. DATABASE_URL (or DB_SECRET_ARN via the container entrypoint) selects the database.
 */
import 'reflect-metadata';
import { createPrismaClient } from '../src/prisma/client-factory';
import { markDemoRows, planDemoRemoval, removeDemoRows } from '../src/common/demo-data';

export type Mode = 'dry-run' | 'confirm' | 'mark';
export function parseMode(argv: string[]): Mode {
  const dry = argv.includes('--dry-run'); const confirm = argv.includes('--confirm'); const mark = argv.includes('--mark');
  if (dry && confirm) throw new Error('--dry-run and --confirm cannot be combined');
  if (mark && (dry || confirm)) throw new Error('--mark stands alone');
  const unknown = argv.filter((a) => !['--dry-run', '--confirm', '--mark'].includes(a));
  if (unknown.length) throw new Error(`unknown argument ${unknown[0]} (use --dry-run, --confirm or --mark)`);
  return mark ? 'mark' : confirm ? 'confirm' : 'dry-run';
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const prisma = createPrismaClient();
  try {
    const dbName = (() => { try { return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1); } catch { return '(from secret)'; } })();
    console.log(`demo-data: mode=${mode} database=${dbName}`);
    if (mode === 'mark') {
      const subs = (() => { try { return Object.values(JSON.parse(process.env.DEMO_SUB_MAP_JSON || '{}')) as string[]; } catch { return []; } })();
      console.log('marked', JSON.stringify(await markDemoRows(prisma as never, { batch: 'backfill', extraSubs: subs })));
      return;
    }
    const plan = await planDemoRemoval(prisma as never);
    for (const t of plan.tables) console.log(`  ${t.table.padEnd(22)} rows=${t.rows} markers=${t.markers}`);
    console.log(`demo-data: ${plan.total} row(s) marked DEMO${plan.orphanMarkers ? `, ${plan.orphanMarkers} marker(s) of unknown tables left alone` : ''}`);
    if (mode === 'dry-run') { console.log('dry run: nothing was changed. Re-run with --confirm to delete exactly these rows.'); return; }
    const done = await prisma.$transaction(async (tx) => removeDemoRows(tx as never), { timeout: 120_000 });
    console.log('deleted', JSON.stringify(done));
    const left = await planDemoRemoval(prisma as never);
    console.log(`demo-data: ${left.total} marked row(s) remain (expected 0)`);
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((e) => { console.error(`demo-data: ${e.message}`); process.exit(1); });
