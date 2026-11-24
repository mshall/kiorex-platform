import { DEFAULT_MARKET } from '../market/market-core-public';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { SEO_EXTENSION_DEFAULTS, SlugBootstrapService, TEMPLATE_KEYS, TEMPLATE_PLACEHOLDERS, validateSeoExtensions } from '../growth/seo/seo-public';
import { PrismaService } from '../prisma/prisma.service';
import { SearchEngineService, SitemapSubmitJob } from './search-engines';
import { SeoConfigService } from './seo-config.service';
import { SeoPagesService } from './seo-pages.service';
import { SitemapService } from './sitemap.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const market = (m?: string): string => (m && /^[A-Za-z]{2}$/.test(m) ? m.toUpperCase() : DEFAULT_MARKET);
const lim = (n: unknown, d = 100, max = 500): number => { const v = Number(n); return Number.isInteger(v) && v >= 1 ? Math.min(v, max) : d; };

/**
 * Ops SEO management (GRW-P1-F). The listings are READ-ONLY (pages and their guard result, slugs, slug history and redirects, the resolved SEO config,
 * search-engine status). The few writes are idempotent maintenance actions that change no content (rebuild the guard table, backfill slugs, submit the
 * sitemap through the mock adapter) and are audited. Editing the SEO configuration itself goes through package K's maker-checker path, which calls
 * `POST config/validate` (the hook) before it stores a version.
 */
@ApiTags('growth')
@OpsOnly()
@Controller('ops/growth/seo')
export class SeoOpsController {
  constructor(
    private readonly pages: SeoPagesService, private readonly seo: SeoConfigService, private readonly bootstrap: SlugBootstrapService, private readonly sitemaps: SitemapService,
    private readonly engines: SearchEngineService, private readonly submitJob: SitemapSubmitJob, private readonly prisma: PrismaService,
  ) {}

  @Get('overview') @ApiOperation({ summary: 'GRW-P1-F SEO overview: page counts and guard reasons, slug coverage, sitemap sizes, search-engine status' }) @ApiOkResponse(OBJ) @ApiQuery({ name: 'market', required: false })
  async overview(@Query('market') m?: string) {
    const mk = market(m);
    const inv = await this.pages.inventory(mk, { limit: 1 });
    const sm = await this.sitemaps.entries(mk);
    const byType: Record<string, number> = {};
    for (const e of sm.entries) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return { market: mk, pages: { total: inv.total, indexable: inv.indexable, noindex: inv.noindex, byReason: inv.byReason }, sitemap: { urlsByType: byType, total: sm.entries.length, shardSize: sm.shardSize }, slugs: await this.pages.slugCoverage(mk), searchEngines: this.engines.status() };
  }

  @Get('pages') @ApiOperation({ summary: 'GRW-P1-F generated pages with guard results (read-only)' }) @ApiOkResponse(OBJ)
  @ApiQuery({ name: 'market', required: false }) @ApiQuery({ name: 'type', required: false }) @ApiQuery({ name: 'indexable', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'offset', required: false })
  pagesList(@Query('market') m?: string, @Query('type') type?: string, @Query('indexable') indexable?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.pages.inventory(market(m), { type: type || undefined, indexable: indexable === undefined || indexable === '' ? undefined : indexable === 'true', limit: lim(limit), offset: Number(offset) > 0 ? Number(offset) : 0 });
  }

  @Get('slugs') @ApiOperation({ summary: 'GRW-P1-F slugs (read-only)' }) @ApiOkResponse(OBJ)
  @ApiQuery({ name: 'market', required: false }) @ApiQuery({ name: 'entityType', required: false }) @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'limit', required: false })
  async slugs(@Query('market') m?: string, @Query('entityType') entityType?: string, @Query('q') q?: string, @Query('limit') limit?: string) {
    const where = { market: market(m), ...(entityType ? { entityType } : {}), ...(q ? { slug: { contains: q.toLowerCase() } } : {}) };
    const [total, items] = await Promise.all([this.prisma.growthSlug.count({ where }), this.prisma.growthSlug.findMany({ where, orderBy: [{ entityType: 'asc' }, { slug: 'asc' }], take: lim(limit), select: { entityType: true, entityId: true, slug: true, createdAt: true, updatedAt: true } })]);
    return { total, items };
  }

  @Get('redirects') @ApiOperation({ summary: 'GRW-P1-F redirect inventory: slug history (301) and delisted providers (301 to the hub or 404 then 410)' }) @ApiOkResponse(OBJ)
  @ApiQuery({ name: 'market', required: false }) @ApiQuery({ name: 'limit', required: false })
  async redirects(@Query('market') m?: string, @Query('limit') limit?: string) {
    const mk = market(m); const cfg = await this.seo.get(mk); const now = Date.now();
    const history = await this.prisma.growthSlugHistory.findMany({ where: { market: mk }, orderBy: { supersededAt: 'desc' }, take: lim(limit), select: { entityType: true, entityId: true, slug: true, replacedBy: true, supersededAt: true } });
    const delisted = await this.prisma.provider.findMany({ where: { market: mk, status: { notIn: ['LIVE', 'PAUSED'] } }, take: lim(limit), orderBy: { syncedAt: 'desc' }, select: { id: true, status: true, specialty: true, syncedAt: true } });
    return {
      slugHistory: history.map((h) => ({ ...h, status: 301, to: h.replacedBy })),
      delisted: delisted.map((d) => ({ providerId: d.id, status: d.status, delistedSince: d.syncedAt, answers: (now - d.syncedAt.getTime()) / 86_400_000 >= cfg.delistedGoneAfterDays ? '410 (or 301 to the specialty hub when it is indexable)' : '404 (or 301 to the specialty hub when it is indexable)' })),
      goneAfterDays: cfg.delistedGoneAfterDays,
    };
  }

  @Get('config') @ApiOperation({ summary: 'GRW-P1-F resolved SEO configuration with the template catalogue (read-only)' }) @ApiOkResponse(OBJ) @ApiQuery({ name: 'market', required: false })
  async config(@Query('market') m?: string) {
    const mk = market(m);
    const resolved = await this.seo.get(mk);
    const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'SEO', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: mk }] }, orderBy: { version: 'asc' }, select: { id: true, version: true, scope: true, scopeId: true, effectiveFrom: true } });
    return { market: mk, resolved, activeVersions: rows, defaults: SEO_EXTENSION_DEFAULTS(), templateKeys: TEMPLATE_KEYS, placeholders: TEMPLATE_PLACEHOLDERS, hook: 'POST /ops/growth/seo/config/validate' };
  }

  @Post('config/validate') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-F validate SEO extension keys (templates, pagination, review markup, thresholds) before a config version is stored (hook for package K); stores nothing' }) @ApiOkResponse(OBJ)
  validate(@Body() body: Record<string, unknown>) { return validateSeoExtensions(body); }

  @Post('rebuild') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-F rebuild the page guard table, drop caches (audited)' }) @ApiOkResponse(OBJ) @ApiQuery({ name: 'market', required: false })
  async rebuild(@CurrentUser() u: AuthUser, @Query('market') m?: string) {
    const mk = market(m);
    this.seo.invalidate(); this.sitemaps.invalidate();
    const r = await this.pages.rebuild(mk);
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.seo.rebuild', resource: 'GrowthLandingPage', metadata: { ...r } } });
    return r;
  }

  @Post('slugs/bootstrap') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-F slug bootstrap and backfill for LIVE providers, clinics, pharmacies and labs (idempotent; dryRun reports only; audited)' }) @ApiOkResponse(OBJ) @ApiQuery({ name: 'market', required: false })
  async slugBootstrap(@CurrentUser() u: AuthUser, @Query('market') m?: string, @Body() body?: { dryRun?: boolean }) {
    const r = await this.bootstrap.runOnce({ market: market(m), dryRun: body?.dryRun === true });
    if (!r.dryRun) await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.seo.slugs.bootstrap', resource: 'GrowthSlug', metadata: { created: r.created, existing: r.existing, collisions: r.collisions } } });
    return r;
  }

  @Get('search-engines') @ApiOperation({ summary: 'GRW-P1-F Search Console and Bing integration status (mock by default)' }) @ApiOkResponse(OBJ)
  searchEngines() { return this.engines.status(); }

  @Get('search-engines/performance') @ApiOperation({ summary: 'GRW-P1-F performance pull through the integration abstraction (mock rows are labelled sample)' }) @ApiOkResponse(OBJ)
  async performance(@Query('from') from?: string, @Query('to') to?: string) { return { mode: this.engines.mode, rows: await this.engines.performance({ from, to }) }; }

  @Post('search-engines/submit-sitemap') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-F submit the sitemap index to the search engines through the adapter (mock by default)' }) @ApiOkResponse(OBJ)
  async submit() { return { mode: this.engines.mode, results: await this.submitJob.runOnce() }; }
}
