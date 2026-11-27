import { Body, Controller, Get, Header, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, OpsOnly, Public, type AuthUser } from '../common/auth';
import { ApiError } from '../common/errors';
import { LeadsService } from './leads.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
export const LEADS_PUBLIC_MAX_BODY = 16 * 1024;
const superOnly = (u: AuthUser) => { if (!u.roles?.includes('super_admin')) throw new ApiError(403, 'SUPER_ADMIN_ONLY', 'Only a super admin can do this'); };

/** Public intake of the Kiorly site's "Join us" form. No credentials: abuse control is the honeypot, strict validation, a 16 KiB body bound, per-IP / per-phone / global rate limits and the idempotency key. */
@ApiTags('leads')
@Controller('public/leads')
export class LeadsPublicController {
  constructor(private readonly svc: LeadsService) {}

  @Public() @Get('config') @Header('Cache-Control', 'public, max-age=60') @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Public: the join form picklists (provider types, specialties, markets and governorates, modules, ...), the required fields and the fields per provider type' })
  config() { return this.svc.publicConfig(); }

  @Public() @Post() @HttpCode(201) @ApiOkResponse(OBJ)
  @ApiOperation({ summary: 'Public: submit a join request. Requires Idempotency-Key (8-64 chars). 201 { reference }; a replay of the same key and body answers the same reference; 400 VALIDATION_FAILED { fields }; 429 RATE_LIMITED' })
  submit(@Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string | undefined, @Req() req: { ip?: string }) { return this.svc.submit(body, { idempotencyKey: key, ip: req.ip }); }
}

/** Ops console and Kiorly admin: Join requests. Both editions call the same API with the same roles (ops_admin, super_admin). */
@ApiTags('ops-leads')
@OpsOnly()
@Controller('admin/leads')
export class LeadsAdminController {
  constructor(private readonly svc: LeadsService) {}

  @Get() @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: join requests, newest first, filters: status, type, market, mode, from, to (YYYY-MM-DD), q, owner, test (only|exclude), duplicates (only), page, pageSize' })
  list(@Query() q: Record<string, string>) { return this.svc.list(q); }

  @Get('summary') @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: counts per status (test data excluded), new in the last 7 days, unassigned open requests' })
  summary() { return this.svc.summaryCounts(); }

  @Get('owners') @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: team members a request can be assigned to' })
  owners(@CurrentUser() u: AuthUser) { return this.svc.owners(u); }

  @Get('settings') @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: the join-flow configuration (picklists, required fields, test markers, notification switches) and its version' })
  settings() { return this.svc.adminConfig(); }

  @Put('settings') @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP (super admin): save the configuration. Send { version, config }; 409 LEAD_CONFIG_STALE when someone saved first. Not a money, legal or safety setting: versioned and audited, no second approver' })
  saveSettings(@CurrentUser() u: AuthUser, @Body() b: { version?: number; config?: unknown }) { superOnly(u); return this.svc.saveConfig(u, b); }

  @Get('export.csv') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Cache-Control', 'no-store') @ApiOkResponse({ description: 'UTF-8 CSV with a BOM, one row per request', content: { 'text/csv': { schema: { type: 'string' } } } }) @ApiOperation({ summary: 'OP: CSV export of the filtered requests (decrypted contact details, audited; max 5000 rows)' })
  async export(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void }) {
    const r = await this.svc.exportCsv(u, q);
    res.setHeader('Content-Disposition', `attachment; filename="kiorly-join-requests-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Export-Rows', String(r.rows)); res.setHeader('X-Export-Truncated', String(r.truncated));
    return r.csv;
  }

  @Post('test/remove') @HttpCode(200) @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP (super admin): delete the requests tagged as test data. { confirm: false } (default) counts only' })
  removeTest(@CurrentUser() u: AuthUser, @Body() b: { confirm?: boolean }) { superOnly(u); return this.svc.removeTestLeads(u, b?.confirm === true); }

  @Get(':id') @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: one request with decrypted contact details, trail and possible duplicates (the read is audited)' })
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.detail(u, id); }

  @Patch(':id') @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: change status (allowed transitions only), lost reason, owner, tags; isTest is super admin only' })
  patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { status?: string; lostReason?: string | null; ownerSub?: string | null; isTest?: boolean; addTags?: string[]; removeTags?: string[] }) { return this.svc.update(u, id, b ?? {}); }

  @Post(':id/notes') @HttpCode(200) @ApiOkResponse(OBJ) @ApiOperation({ summary: 'OP: add an internal note' })
  note(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { text?: string }) { return this.svc.addNote(u, id, b?.text ?? ''); }
}
