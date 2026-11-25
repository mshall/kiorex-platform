import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEFAULT_MARKET } from '../../market/market-core-public';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { can, rolesFor } from '../admin/growth-access';
import { IntegrationsCenterService } from './integrations-center.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const marketOf = (m?: string) => (m && /^[A-Z]{2}$/.test(m) ? m : DEFAULT_MARKET);
class TestSendBody { @IsString() @MaxLength(64) to!: string; @IsOptional() @IsString() @MaxLength(2) market?: string }
class ProposeBody { @IsIn(['mock', 'real']) mode!: 'mock' | 'real'; @IsString() @MaxLength(500) reason!: string }

/**
 * Integrations Control Center API. Reads: every Growth ops role (non-super-admins are read-only). Check, test send and mode proposal: super admin only.
 * Nothing here accepts or returns a credential. The second half of a mode change is the existing maker-checker console.
 */
@ApiTags('integrations-center')
@Roles(...rolesFor('read'))
@Controller('admin/integrations-center')
export class IntegrationsCenterController {
  constructor(private readonly svc: IntegrationsCenterService) {}

  @Get() @ApiOperation({ summary: 'Every external integration: mode, approved mode and drift, secret presence (boolean), last check, circuit, webhook, required variable names, runbook' }) @ApiOkResponse(OBJ)
  async overview(@CurrentUser() u: AuthUser, @Query('market') market?: string) { return { ...(await this.svc.overview(marketOf(market))), canManage: can(u.roles, 'manage') }; }

  @Roles(...rolesFor('manage')) @Post(':key/check') @HttpCode(200) @ApiOperation({ summary: 'Mock-safe connection check (configuration only; no vendor call)' }) @ApiOkResponse(OBJ)
  check(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query('market') market?: string) { return this.svc.check(key, u.sub, marketOf(market)); }

  @Roles(...rolesFor('manage')) @Post(':key/test-send') @HttpCode(200) @ApiOperation({ summary: 'Adapter-level test send (mock mode only; real mode is refused)' }) @ApiOkResponse(OBJ)
  testSend(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: TestSendBody) { return this.svc.testSend(key, u.sub, b.to, marketOf(b.market)); }

  @Roles(...rolesFor('manage')) @Post(':key/propose-mode') @HttpCode(200) @ApiOperation({ summary: 'Ask for a mock or real mode: creates and submits an INTEGRATION_MODES maker-checker version; a different super admin approves it' }) @ApiOkResponse(OBJ)
  propose(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: ProposeBody) { return this.svc.proposeMode({ sub: u.sub, roles: u.roles }, key, b.mode, b.reason); }
}
