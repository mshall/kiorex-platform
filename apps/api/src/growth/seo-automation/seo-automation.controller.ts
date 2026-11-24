import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth';
import { rolesFor } from '../admin/growth-access';
import { SeoIndexationService } from './indexation.service';
import { SeoAutomationService } from './seo-automation.service';
import { SeoVitalsService } from './vitals.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/** Ops API of the SEO automation (GRW-P3-F): read for every growth reader, run and ingest for super admins. Nothing here changes a page by itself: `autoNoindex` lives in the SEO_AUTOMATION configuration. */
@ApiTags('growth-seo-automation')
@Roles(...rolesFor('read'))
@Controller('admin/growth/seo-automation')
export class SeoAutomationController {
  constructor(private readonly seo: SeoAutomationService, private readonly vitals: SeoVitalsService, private readonly indexation: SeoIndexationService) {}

  @Get('overview') @ApiOperation({ summary: 'GRW-P3-F quality overview by template, worst pages, link counts, orphans' }) @ApiOkResponse(OBJ)
  overview() { return this.seo.overview(); }
  @Get('reports') @ApiOperation({ summary: 'GRW-P3-F latest quality reports' }) @ApiOkResponse(OBJ)
  async reports(@Query('templateKind') templateKind?: string, @Query('locale') locale?: string, @Query('failed') failed?: string) {
    const rows = (await this.seo.latestReports(DEFAULT_MARKET)).filter((r) => (!templateKind || r.templateKind === templateKind) && (!locale || r.locale === locale) && (failed !== 'true' || r.failedChecks.some((c) => !c.startsWith('~'))));
    return { rows: rows.slice(0, 500).map((r) => ({ pageKey: r.pageKey, templateKind: r.templateKind, locale: r.locale, score: r.score, failedChecks: r.failedChecks.filter((c) => !c.startsWith('~')), noindex: r.failedChecks.includes('~noindex'), checkedAt: r.checkedAt })) };
  }
  @Get('config') @ApiOperation({ summary: 'GRW-P3-F effective SEO_AUTOMATION configuration (read-only)' }) @ApiOkResponse(OBJ)
  async config() { const c = await this.seo.config(); return { config: c, editable: false, source: c.version === null ? 'PROPOSED_DEFAULT' : 'ACTIVE' }; }
  @Get('links') @ApiOperation({ summary: 'GRW-P3-F computed internal links of one page, or the totals' }) @ApiOkResponse(OBJ)
  async links(@Query('from') from?: string) {
    if (!from) return { totals: (await this.seo.overview()).links };
    return { from, groups: await this.seo.computedLinks(DEFAULT_MARKET, from, 'en') };
  }
  @Get('vitals') @ApiOperation({ summary: 'GRW-P3-F lab and field Core Web Vitals by template with budgets (not measured is said plainly)' }) @ApiOkResponse(OBJ)
  vitalsOverview() { return this.vitals.overview(); }
  @Get('indexation') @ApiOperation({ summary: 'GRW-P3-F submitted, excluded and indexed per template group' }) @ApiOkResponse(OBJ)
  indexationOverview() { return this.indexation.overview(); }

  @Roles(...rolesFor('manage')) @Post('run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-F run the quality gate and the link builder now' }) @ApiOkResponse(OBJ)
  async run() { const r = await this.seo.run({}); await this.indexation.snapshot(); return r; }
  @Roles(...rolesFor('manage')) @Post('vitals/ingest') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-F ingest the Lighthouse summary (body or file) and the CrUX field rows, then check budgets' }) @ApiOkResponse(OBJ)
  async ingest(@Body() body: { summary?: unknown }) {
    const lab = await this.vitals.ingestLab(body?.summary); const field = await this.vitals.ingestField();
    return { lab, field, check: await this.vitals.check() };
  }
}
