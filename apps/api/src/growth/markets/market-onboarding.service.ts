import { Injectable } from '@nestjs/common';
import { badRequest, conflict, notFound, unprocessable } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { CODE_PROFILES, MarketProfileService, validateMarketProfile } from '../../market/market-core-public';
import { PrismaService } from '../../prisma/prisma.service';
import { SPECIALTY_CODES, SPECIALTY_LABELS } from '../../safety/safety-public';
import { GrowthConfigService, validateGrowthConfig, type ConfigActor } from '../config/growth-config.service';
import { buildBundle, type Steps } from './config-bundle';
import { loadDataCells } from './data-cells';
import { decodeCsv, parseGeography } from './geography-csv';
import { isStep, STEPS, validateStep } from './onboarding-steps';
import { readiness, type ReadinessFacts } from './readiness';

const CC = /^[A-Z]{2}$/;
const flagKey = (cc: string) => `market.${cc.toLowerCase()}.live`;
export interface CsvInput { text?: string; base64?: string; encoding?: string }

/**
 * Market onboarding wizard (GRW-P3-G). A new market is created from the console as plan answers, geography rows and three drafted configuration versions that a SECOND super admin
 * approves (existing maker-checker). The wizard never makes a market live (`market.<cc>.live` is a launch-locked flag, recorded by a person), never edits source, and refuses a country
 * the code fallback already covers (EG, SA, AE change through their configuration versions). Audit rows carry the step name and counts, never answers.
 */
@Injectable()
export class MarketOnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService, private readonly flags: FlagsService, private readonly profiles: MarketProfileService) {}

  private async audit(actor: string, action: string, cc: string, metadata: Record<string, unknown> = {}) { await this.prisma.auditLog.create({ data: { actor, action: `growth.market_onboarding.${action}`, resource: 'MarketOnboardingPlan', resourceId: cc, metadata: metadata as never } }); }
  private assertCc(cc: string) { if (!CC.test(cc)) throw badRequest('GROWTH_INVALID_REQUEST', 'A market code is two capital letters (ISO 3166-1 alpha-2)'); }
  private async plan(cc: string) { this.assertCc(cc); const p = await this.prisma.marketOnboardingPlan.findUnique({ where: { cc } }); if (!p) throw notFound('MARKET_PLAN_NOT_FOUND', `No onboarding plan for ${cc}`); return p; }
  private present(p: { cc: string; status: string; steps: unknown; createdBy: string; createdAt: Date; updatedAt: Date; readyAt: Date | null; publishedAt: Date | null }) { return { cc: p.cc, status: p.status, steps: p.steps, createdBy: p.createdBy, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), readyAt: p.readyAt?.toISOString() ?? null, publishedAt: p.publishedAt?.toISOString() ?? null }; }

  async list() { return (await this.prisma.marketOnboardingPlan.findMany({ orderBy: { cc: 'asc' } })).map((p) => this.present(p)); }
  async get(cc: string) { return this.present(await this.plan(cc)); }
  catalogue() { return { steps: [...STEPS], dataCells: loadDataCells(), existing: Object.keys(CODE_PROFILES), specialties: SPECIALTY_CODES.map((code) => ({ code, ...SPECIALTY_LABELS[code] })) }; }

  async create(actor: ConfigActor, cc: string) {
    this.assertCc(cc);
    if (CODE_PROFILES[cc]) throw conflict('MARKET_EXISTS', `${cc} is already a market of the code fallback; change it through its configuration versions`);
    if (await this.prisma.marketOnboardingPlan.findUnique({ where: { cc } })) throw conflict('MARKET_PLAN_EXISTS', `An onboarding plan for ${cc} already exists`);
    const row = await this.prisma.marketOnboardingPlan.create({ data: { cc, createdBy: actor.sub } });
    await this.audit(actor.sub, 'create', cc); return this.present(row);
  }

  async setStep(actor: ConfigActor, cc: string, step: string, payload: unknown) {
    const p = await this.plan(cc);
    if (!isStep(step)) throw badRequest('GROWTH_INVALID_REQUEST', `Unknown step ${step}`);
    if (p.status === 'PUBLISHED' || p.status === 'CANCELLED') throw conflict('MARKET_PLAN_LOCKED', 'The plan is published: change the market through its configuration versions');
    const errors = validateStep(step, payload); if (errors.length) throw unprocessable('GROWTH_CONFIG_INVALID', 'The answer does not validate', { errors });
    if (step === 'residency') { /* validated against the cells list above */ }
    const steps = { ...(p.steps as Record<string, unknown>), [step]: payload };
    const row = await this.prisma.marketOnboardingPlan.update({ where: { cc }, data: { steps: steps as never, status: 'DRAFT', readyAt: null } });
    await this.audit(actor.sub, 'step', cc, { step }); return this.present(row);
  }

  previewGeography(input: CsvInput) {
    const d = decodeCsv(input); if ('error' in d) return { ok: false, errors: [d.error], cities: 0, districts: 0, sample: [], totalLines: 0 };
    const r = parseGeography(d.text); return { ok: r.errors.length === 0, errors: r.errors, cities: r.cities, districts: r.districts, totalLines: r.totalLines, truncatedErrors: r.truncatedErrors, sample: r.rows.slice(0, 20) };
  }

  /** Replaces the market's geography with the file (all or nothing) and mirrors the English slugs into `GrowthSlug` so the public pages and the market card count them. */
  async importGeography(actor: ConfigActor, cc: string, input: CsvInput) {
    const p = await this.plan(cc);
    if (p.status === 'PUBLISHED' || p.status === 'CANCELLED') throw conflict('MARKET_PLAN_LOCKED', 'The plan is published');
    const d = decodeCsv(input); if ('error' in d) throw unprocessable('GEOGRAPHY_INVALID', d.error.message, { errors: [d.error] });
    const r = parseGeography(d.text); if (r.errors.length) throw unprocessable('GEOGRAPHY_INVALID', 'The geography file has errors; nothing was imported', { errors: r.errors, truncatedErrors: r.truncatedErrors });
    await this.prisma.$transaction(async (tx) => {
      await tx.marketGeography.deleteMany({ where: { market: cc } });
      for (let i = 0; i < r.rows.length; i += 2000) await tx.marketGeography.createMany({ data: r.rows.slice(i, i + 2000).map((g) => ({ market: cc, ...g })) });
      await tx.growthSlug.deleteMany({ where: { market: cc, entityType: { in: ['CITY', 'DISTRICT'] } } });
      for (let i = 0; i < r.rows.length; i += 2000) await tx.growthSlug.createMany({ data: r.rows.slice(i, i + 2000).map((g) => ({ market: cc, entityType: g.level, entityId: g.key, slug: g.slugEn })) });
      const steps = { ...(p.steps as Record<string, unknown>), geography: { count: r.rows.length, cities: r.cities, districts: r.districts, importedAt: new Date().toISOString() } };
      await tx.marketOnboardingPlan.update({ where: { cc }, data: { steps: steps as never, status: 'DRAFT', readyAt: null } });
    }, { timeout: 120_000 });
    await this.audit(actor.sub, 'geography', cc, { cities: r.cities, districts: r.districts }); return { cities: r.cities, districts: r.districts };
  }
  async geography(cc: string, level?: string) { this.assertCc(cc); return this.prisma.marketGeography.findMany({ where: { market: cc, ...(level === 'CITY' || level === 'DISTRICT' ? { level } : {}) }, orderBy: [{ level: 'asc' }, { key: 'asc' }], take: 5000, select: { level: true, key: true, parentKey: true, nameAr: true, nameEn: true, slugAr: true, slugEn: true, active: true } }); }

  async readiness(cc: string) {
    const p = await this.plan(cc); await this.profiles.refresh().catch(() => undefined);
    const [cities, districts, versions, def, live, sameCell] = await Promise.all([
      this.prisma.marketGeography.count({ where: { market: cc, level: 'CITY' } }), this.prisma.marketGeography.count({ where: { market: cc, level: 'DISTRICT' } }),
      this.prisma.growthConfigVersion.findMany({ where: { scope: 'MARKET', scopeId: cc, kind: { in: ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS'] }, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE'] } }, select: { kind: true, status: true }, orderBy: { version: 'asc' } }),
      this.prisma.flagDefinition.findUnique({ where: { key: flagKey(cc) }, select: { key: true } }), this.flags.isEnabled(flagKey(cc), { market: cc }).catch(() => false), this.sameCell(cc, (p.steps as Steps).residency?.dataCellId as string | undefined),
    ]);
    const rank = { NONE: 0, DRAFT: 1, PENDING_APPROVAL: 2, APPROVED: 3, ACTIVE: 4 } as const; const v: ReadinessFacts['versions'] = {};
    for (const r of versions) { const k = r.kind as 'MARKET_PROFILE'; const s = r.status as keyof typeof rank; if ((rank[v[k] ?? 'NONE'] ?? 0) < rank[s]) v[k] = s; }
    const out = readiness({ steps: p.steps as Steps, geography: { cities, districts }, versions: v, flagDefined: !!def, live, sameCellMarkets: sameCell });
    return { cc, status: p.status, ...out, dataCell: (p.steps as Steps).residency?.dataCellId ?? null, sameCellMarkets: sameCell };
  }
  /** Markets already bound to the same data cell (the production binding file plus the other plans). With one cell every market is "same cell": cross-cell routing does not exist until a second cell does. */
  private async sameCell(cc: string, cell?: string): Promise<string[]> {
    if (!cell) return [];
    const others = await this.prisma.marketOnboardingPlan.findMany({ where: { cc: { not: cc } }, select: { cc: true, steps: true } });
    const bound = Object.entries(loadDataCells().bindings).filter(([, c]) => c === cell).map(([m]) => m);
    return [...new Set([...bound, ...others.filter((o) => ((o.steps as Steps).residency?.dataCellId) === cell).map((o) => o.cc)])].filter((c) => c !== cc).sort();
  }

  /** Maker side: drafts the three configuration versions (submitted for approval) and registers the launch-locked live flag. The checker is a second super admin in the existing config page. */
  async publish(actor: ConfigActor, cc: string) {
    const p = await this.plan(cc); const steps = p.steps as Steps;
    const missing = (['identity', 'regulation', 'consent', 'residency'] as const).filter((s) => !steps[s] || validateStep(s, steps[s]).length);
    if (missing.length) throw unprocessable('MARKET_PLAN_INCOMPLETE', `Answer these steps first: ${missing.join(', ')}`, { missing });
    const b = buildBundle(cc, steps);
    const problems: string[] = [];
    for (const [kind, payload] of Object.entries(b)) { const v = kind === 'MARKET_PROFILE' ? { valid: validateMarketProfile(payload).length === 0, errors: validateMarketProfile(payload) } : validateGrowthConfig(kind, payload); if (!v.valid) problems.push(`${kind}: ${(v as { errors: string[] }).errors.join('; ')}`); }
    if (problems.length) throw unprocessable('GROWTH_CONFIG_INVALID', 'The bundle does not validate', { errors: problems });
    const drafted: Record<string, { id: string; version: number; status: string }> = {};
    for (const kind of ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS'] as const) {
      const d = await this.config.createDraft(actor, { kind, scope: 'MARKET', scopeId: cc, payload: b[kind], reason: `Market onboarding wizard for ${cc}` });
      const s = await this.config.submit(actor, d.id); drafted[kind] = { id: s.id, version: s.version, status: s.status };
    }
    await this.flags.registerDefinition(actor.sub, { key: flagKey(cc), product: 'all', class: 'LAUNCH_LOCKED', scopes: ['GLOBAL'], dependsOn: [], launchLocked: true, description: `Market ${cc} is live (human gate)`, whenOff: 'Country hidden from sign-up and search; existing tenants unaffected', gateHint: 'NEEDS_HUMAN: market pack certification and local counsel; recorded by a person in the super admin' });
    await this.prisma.marketOnboardingPlan.update({ where: { cc }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    await this.audit(actor.sub, 'publish', cc, { kinds: Object.keys(drafted) });
    return { cc, drafted, flag: flagKey(cc), next: 'A second super admin approves the three versions in Growth configuration; the market gate stays a human decision.' };
  }

  async cancel(actor: ConfigActor, cc: string) { const p = await this.plan(cc); if (p.status === 'PUBLISHED') throw conflict('MARKET_PLAN_LOCKED', 'A published plan cannot be cancelled'); await this.prisma.marketOnboardingPlan.update({ where: { cc }, data: { status: 'CANCELLED' } }); await this.audit(actor.sub, 'cancel', cc); return { cc, status: 'CANCELLED' }; }
}
