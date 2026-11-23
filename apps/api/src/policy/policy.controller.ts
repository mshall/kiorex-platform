import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, SuperAdminOnly } from '../common/auth';
import { PolicyService } from './policy.service';

export class PolicyOverrideDto {
  @ApiProperty({ enum: ['GLOBAL', 'MARKET', 'ORG'] }) scope!: string;
  @ApiProperty() scopeId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) value!: Record<string, unknown>;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() updatedBy!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class PolicyItemDto {
  @ApiProperty({ example: 'pay.deposit_default' }) key!: string;
  @ApiProperty() titleEn!: string; @ApiProperty() titleAr!: string;
  @ApiProperty() descriptionEn!: string; @ApiProperty() descriptionAr!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Resolved value for the market' }) value!: Record<string, unknown>;
  @ApiProperty({ enum: ['ORG', 'MARKET', 'GLOBAL', 'PROPOSED_DEFAULT'] }) source!: string;
  @ApiProperty({ description: 'true while the value is the in-code PROPOSED_DEFAULT (founder-delegated 23 Nov 2026), i.e. no override stored' }) proposedDefault!: boolean;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) defaults!: Record<string, unknown>;
  @ApiProperty({ type: [String] }) scopes!: string[];
  @ApiProperty({ type: [PolicyOverrideDto] }) overrides!: PolicyOverrideDto[];
}
export class PolicyDescribeDto {
  @ApiProperty({ example: 'EG' }) market!: string;
  @ApiProperty() proposedDefaultNote!: string;
  @ApiProperty({ type: [PolicyItemDto] }) items!: PolicyItemDto[];
}
export class SetPolicyBody {
  @ApiProperty({ enum: ['GLOBAL', 'MARKET', 'ORG'] }) @IsIn(['GLOBAL', 'MARKET', 'ORG']) scope!: 'GLOBAL' | 'MARKET' | 'ORG';
  @ApiPropertyOptional({ description: 'MARKET: ISO country code; ORG: partner / clinic organisation id; GLOBAL: omit' }) @IsOptional() @IsString() @MaxLength(64) scopeId?: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Validated against the policy definition (e.g. { enabled, percentBps, capMajor })' }) @IsObject() value!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class PolicySetResultDto {
  @ApiProperty() key!: string; @ApiProperty() scope!: string; @ApiProperty() scopeId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) value!: Record<string, unknown>;
}
export class PolicyClearResultDto { @ApiProperty() cleared!: number }

/** Ops console "Market policy": values resolved per market with their source (PROPOSED_DEFAULT vs override). Reads: ops; writes: super admin, audited. */
@ApiTags('policy')
@Controller('admin/policy')
export class PolicyController {
  constructor(private readonly svc: PolicyService) {}

  @OpsOnly() @Get() @ApiOperation({ summary: 'OP: business policies resolved for a market (default EG), with source and overrides' })
  @ApiQuery({ name: 'market', required: false, description: 'ISO country code (default EG)' })
  @ApiOkResponse({ type: PolicyDescribeDto })
  describe(@Query('market') market = 'EG') { return this.svc.describe(market); }

  @SuperAdminOnly() @Put(':key') @HttpCode(200) @ApiOperation({ summary: 'SA: set a policy override at GLOBAL, MARKET or ORG scope (validated, audited)' })
  @ApiOkResponse({ type: PolicySetResultDto })
  set(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: SetPolicyBody) { return this.svc.set(key, b, u.sub); }

  @SuperAdminOnly() @Delete(':key') @ApiOperation({ summary: 'SA: remove an override (falls back to the next level / PROPOSED_DEFAULT)' })
  @ApiQuery({ name: 'scope', enum: ['GLOBAL', 'MARKET', 'ORG'] }) @ApiQuery({ name: 'scopeId', required: false })
  @ApiOkResponse({ type: PolicyClearResultDto })
  clear(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query('scope') scope: 'GLOBAL' | 'MARKET' | 'ORG', @Query('scopeId') scopeId?: string) { return this.svc.clear(key, { scope, scopeId }, u.sub); }
}
