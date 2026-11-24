import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { SlugService } from '../slugs/slug.service';
import type { SlugEntityType } from '../slugs/slug';
import { proposeSlug } from './slug-names';

export interface BootstrapReport {
  market: string; dryRun: boolean; startedAt: string;
  considered: Record<'DOCTOR' | 'CLINIC' | 'PHARMACY' | 'LAB', number>;
  created: Record<'DOCTOR' | 'CLINIC' | 'PHARMACY' | 'LAB', number>;
  existing: number; collisions: number; fallbacks: number;
}

const pick = (raw: unknown, ...path: string[]): string | null => {
  let v: unknown = raw;
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === 'string' && v ? v : null;
};

/**
 * Slug bootstrap and backfill (GRW-P1-F, ARCH 4.1 rules 1 and 2). Gives every LIVE (or PAUSED) provider, nurse, clinic, pharmacy and lab a stable
 * GrowthSlug through SlugService.ensure: idempotent, concurrency safe, collision handling (-2, -3 ...), history untouched. Kiorex-owned: a later change of
 * the Kiorly booking link never moves a URL. `dryRun` reports what would be created without writing. Runs from the job below, from the ops endpoint
 * `POST /ops/growth/seo/slugs/bootstrap` and by hand (`runOnce`).
 */
@Injectable()
export class SlugBootstrapService {
  constructor(private readonly prisma: PrismaService, private readonly slugs: SlugService) {}

  async runOnce(o: { market?: string; dryRun?: boolean; pageSize?: number } = {}): Promise<BootstrapReport> {
    const market = o.market ?? GROWTH_DEFAULT_MARKET; const dryRun = !!o.dryRun; const pageSize = o.pageSize ?? 500;
    const r: BootstrapReport = { market, dryRun, startedAt: new Date().toISOString(), considered: { DOCTOR: 0, CLINIC: 0, PHARMACY: 0, LAB: 0 }, created: { DOCTOR: 0, CLINIC: 0, PHARMACY: 0, LAB: 0 }, existing: 0, collisions: 0, fallbacks: 0 };
    const have = async (type: SlugEntityType, id: string) => !!(await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: type, entityId: id } }, select: { id: true } }));
    const one = async (type: 'DOCTOR' | 'CLINIC' | 'PHARMACY' | 'LAB', id: string, names: { bookingSlug?: string | null; nameEn?: string | null; nameAr?: string | null }) => {
      r.considered[type]++;
      if (await have(type, id)) { r.existing++; return; }
      const proposal = proposeSlug(names, type, id);
      if (proposal.source === 'FALLBACK') r.fallbacks++;
      if (dryRun) { r.created[type]++; return; }
      const slug = await this.slugs.ensure({ entityType: type, entityId: id, name: proposal.slug, market });
      r.created[type]++;
      if (slug !== proposal.slug) r.collisions++;
    };

    // providers (doctors, physios and nurses share the DOCTOR slug namespace, ARCH 4.1) and their clinics
    let cursor: string | undefined;
    const clinics = new Map<string, { nameEn: string | null; nameAr: string | null; bookingSlug: string | null }>();
    for (;;) {
      const rows = await this.prisma.provider.findMany({
        where: { market, status: { in: ['LIVE', 'PAUSED'] } }, orderBy: { id: 'asc' }, take: pageSize, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, clinicId: true, nameEn: true, nameAr: true, clinicNameEn: true, clinicNameAr: true, raw: true },
      });
      if (!rows.length) break;
      for (const p of rows) {
        await one('DOCTOR', p.id, { bookingSlug: pick(p.raw, 'provider', 'bookingSlug') ?? pick(p.raw, 'bookingSlug'), nameEn: p.nameEn, nameAr: p.nameAr });
        if (!clinics.has(p.clinicId)) clinics.set(p.clinicId, { nameEn: p.clinicNameEn, nameAr: p.clinicNameAr, bookingSlug: pick(p.raw, 'clinic', 'bookingSlug') });
      }
      cursor = rows[rows.length - 1]!.id;
      if (rows.length < pageSize) break;
    }
    for (const [id, c] of [...clinics].sort(([a], [b]) => (a < b ? -1 : 1))) await one('CLINIC', id, c);

    // pharmacies and labs: LIVE partner connections (the registry that the pharmacy and lab flows use)
    const partners = await this.prisma.partnerConnection.findMany({ where: { market, status: 'LIVE', kind: { in: ['PHARMACY', 'LAB'] } }, orderBy: { id: 'asc' }, select: { id: true, kind: true, name: true, nameAr: true } });
    for (const pc of partners) await one(pc.kind as 'PHARMACY' | 'LAB', pc.id, { nameEn: pc.name, nameAr: pc.nameAr });
    return r;
  }
}

/** Keeps new listings sluggable without an operator: a backfill at start-up and every 15 minutes while jobs are enabled. Never throws into the process. */
@Injectable()
export class SlugBootstrapJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('growth-slug-bootstrap');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  constructor(private readonly svc: SlugBootstrapService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    const run = () => void this.svc.runOnce().then((r) => { const n = Object.values(r.created).reduce((a, b) => a + b, 0); if (n) this.log.log(`slugs created: ${n}`); }).catch((e) => this.log.warn(`slug bootstrap failed: ${e.message}`));
    this.first = setTimeout(run, 20_000); this.first.unref();
    this.timer = setInterval(run, 15 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.first) clearTimeout(this.first); }
}
