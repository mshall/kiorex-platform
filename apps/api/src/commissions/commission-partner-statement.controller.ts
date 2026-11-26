import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { applyDecorators } from '@nestjs/common';
import { ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { CommissionPartnerStatementService, type PartnerStatementReq } from './commission-partner-statement.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const SIGNED = () => applyDecorators(
  ApiHeader({ name: 'X-Kiorly-Client-Key', required: true, description: 'Partner client key (Clinic: the Clinic key; Pharmacy and Lab: the registered client key)' }),
  ApiHeader({ name: 'X-Kiorly-Timestamp', required: true, description: 'Unix milliseconds, within 5 minutes of the server clock' }),
  ApiHeader({ name: 'X-Kiorly-Nonce', required: true, description: 'One-time value; a replay is 401' }),
  ApiHeader({ name: 'X-Kiorly-Signature', required: true, description: 'Kiorly request HMAC over method, path (query excluded) and body hash, keyed with the partner webhook secret (Clinic: its per-organisation secret, or the shared Clinic secret while the deployment still allows it)' }),
  ApiHeader({ name: 'X-Kiorly-Query-Signature', required: false, description: 'base64url HMAC-SHA256, same secret, over "kiorly-query-v1\\n<timestamp>\\n<nonce>\\n<METHOD>\\n<path>\\n<sorted, percent-encoded key=value pairs joined by &>". Optional until the deployment sets COMMISSION_STATEMENT_QUERY_SIGNATURE=required; a present signature that does not verify is 401' }),
  ApiHeader({ name: 'X-Kiorly-Org-Ref', required: false, description: 'Clinic: the tenant id (required). Pharmacy and Lab: optional, must equal the partner registration or the request is 403' }),
  ApiUnauthorizedResponse({ description: 'Unsigned, unknown key, wrong secret, stale or replayed signature' }),
  ApiForbiddenResponse({ description: 'PARTNER_ORG_MISMATCH: another organisation was named' }),
  ApiTooManyRequestsResponse({ description: 'PARTNER_RATE_LIMITED, with Retry-After' }),
);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * LG-COM-19: read-only settlement statement for a signed partner product (Clinic, Pharmacy, Lab). Kiorly request HMAC (X-Kiorly-Client-Key, -Timestamp, -Nonce, -Signature over method, path and body hash),
 * one-time nonce, one organisation only (the authenticated partner's own; see CommissionPartnerStatementService). No ops session, no organisation in the path. Rate limited and audited.
 */
@ApiTags('partner')
@Controller('partner/commissions/settlement-statement')
export class CommissionPartnerStatementController {
  constructor(private readonly svc: CommissionPartnerStatementService) {}

  @Public() @SIGNED() @Get()
  @ApiOperation({ summary: 'Settlement statement of the signed partner\'s own organisation and period (same figures and shape as the ops route; Clinic: tenant in X-Kiorly-Org-Ref; Pharmacy and Lab: the partner registration)' }) @ApiOkResponse(OBJ)
  async statement(@Req() req: PartnerStatementReq, @Query('from') from?: string, @Query('to') to?: string) {
    const a = await this.svc.authenticate(req);
    return this.svc.statement(a, { from: str(from), to: str(to) });
  }

  @Public() @SIGNED() @Get('export')
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'CSV of the same statement (audited)' }) @ApiOkResponse({ description: 'CSV', schema: { type: 'string' } })
  async statementCsv(@Req() req: PartnerStatementReq, @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void }, @Query('from') from?: string, @Query('to') to?: string) {
    const a = await this.svc.authenticate(req);
    const r = await this.svc.exportCsv(a, { from: str(from), to: str(to) });
    res.setHeader('content-disposition', `attachment; filename="${r.filename}"`);
    return r.csv;
  }
}
