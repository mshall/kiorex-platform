import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { OpsOnly } from '../common/auth';
import { PartnerRegistry } from './partners.service';

export class PartnerDto {
  @ApiProperty() id!: string; @ApiProperty({ enum: ['pharmacy', 'lab', 'lab_nurse'] }) kind!: string; @ApiProperty() name!: string;
  @ApiProperty({ description: 'Host only, e.g. http://localhost:3100' }) baseUrl!: string; @ApiProperty() clientKey!: string;
  @ApiProperty({ description: 'Always masked' }) clientSecret!: string; @ApiProperty({ description: 'Always masked' }) webhookSecret!: string;
  @ApiProperty() active!: boolean; @ApiProperty({ description: 'Contract path appended to baseUrl' }) apiPath!: string;
  @ApiProperty({ nullable: true, description: 'lab_nurse only: the lab registration (same lab tenant) this nurse client belongs to' }) labRegistrationId!: string | null;
  @ApiProperty() createdAt!: string; @ApiProperty() updatedAt!: string;
}
export class PartnerBody {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) baseUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) clientKey?: string;
  @ApiPropertyOptional({ description: 'Write-only' }) @IsOptional() @IsString() @MaxLength(200) clientSecret?: string;
  @ApiPropertyOptional({ description: 'Write-only' }) @IsOptional() @IsString() @MaxLength(200) webhookSecret?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ description: 'lab_nurse only: id of the lab registration this nurse client belongs to (routes Nurse lab orders to the lab that owns them); empty string clears' }) @IsOptional() @IsString() @MaxLength(80) labRegistrationId?: string;
}

/** Ops-editable partner registrations (base URL / keys per partner record). Secrets are write-only. */
@ApiTags('ops')
@OpsOnly()
@Controller('admin/partners')
export class PartnersController {
  constructor(private readonly registry: PartnerRegistry) {}
  @Get() @ApiOperation({ summary: 'OP: partner registrations (Kiorly Pharmacy / Lab); secrets masked' }) @ApiOkResponse({ type: PartnerDto, isArray: true })
  list() { return this.registry.list(); }
  @Post(':kind') @HttpCode(201) @ApiOperation({ summary: 'OP: register a partner (pharmacy|lab)' }) @ApiOkResponse({ type: PartnerDto })
  create(@Param('kind') kind: string, @Body() b: PartnerBody) { return this.registry.upsert(kind, undefined, b); }
  @Put(':kind/:id') @ApiOperation({ summary: 'OP: update base URL / keys / active of a partner registration' }) @ApiOkResponse({ type: PartnerDto })
  update(@Param('kind') kind: string, @Param('id') id: string, @Body() b: PartnerBody) { return this.registry.upsert(kind, id, b); }
}
