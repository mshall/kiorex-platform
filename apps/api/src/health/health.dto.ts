import { ApiProperty } from '@nestjs/swagger';

export class LiveDto { @ApiProperty({ example: 'ok' }) status!: string }
export class ProviderStatusDto {
  @ApiProperty({ example: 'whatsapp' }) provider!: string;
  @ApiProperty({ enum: ['mock', 'real'] }) mode!: string;
  @ApiProperty({ example: 'meta' }) vendor!: string;
  @ApiProperty({ description: 'All required variables for the active mode are present' }) ready!: boolean;
}
export class LeadSigningDto {
  @ApiProperty({ enum: ['configured', 'not configured'], description: 'PARTNER_LEAD_SIGNING_SECRET present (never the value)' }) status!: string;
  @ApiProperty({ description: 'A previous secret is also accepted (rotation window)' }) previousAccepted!: boolean;
}
export class ReadyDto {
  @ApiProperty({ example: 'ready' }) status!: string;
  @ApiProperty({ example: 'up', required: false, description: 'Internal callers only (loopback / private address without a proxy header, or X-Health-Token); the public answer is just `status`' }) db?: string;
  @ApiProperty({ type: [ProviderStatusDto], required: false, description: 'Internal callers only' }) providers?: ProviderStatusDto[];
  @ApiProperty({ type: LeadSigningDto, required: false, description: 'Internal callers only' }) leadSigning?: LeadSigningDto;
}
export class ProvidersDto { @ApiProperty({ type: [ProviderStatusDto] }) providers!: ProviderStatusDto[] }
