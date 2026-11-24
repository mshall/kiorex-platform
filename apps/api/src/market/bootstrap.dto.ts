import { DEFAULT_MARKET } from './market-registry';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BootstrapMarketDto {
  @ApiProperty({ example: DEFAULT_MARKET }) code!: string;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({ example: '+20' }) phoneCode!: string;
  @ApiProperty({ example: { ar: 'مصر', en: 'Egypt' } }) name!: { ar: string; en: string };
  @ApiProperty({ example: 'https://api.example.com/api/v1', description: 'Regional API base for this market (binding), with /api/v1' }) apiEndpoint!: string;
}
export class BootstrapCapabilitiesDto {
  @ApiProperty() deepLinks!: boolean;
  @ApiProperty() marketplace!: boolean;
  @ApiProperty() homeVisits!: boolean;
}
export class BootstrapDto {
  @ApiProperty({ example: DEFAULT_MARKET }) defaultMarket!: string;
  @ApiProperty({ example: DEFAULT_MARKET, description: 'The link or account market when LIVE, else the default. Never derived from IP or device location.' }) resolvedMarket!: string;
  @ApiProperty({ type: [String], example: [DEFAULT_MARKET] }) liveMarkets!: string[];
  @ApiProperty({ type: [BootstrapMarketDto] }) markets!: BootstrapMarketDto[];
  @ApiProperty({ enum: ['ar', 'en'], isArray: true }) locales!: ('ar' | 'en')[];
  @ApiProperty({ description: 'False unless more than one market is live (founder rule 23 Nov 2026).' }) showMarketSelector!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) minAppVersion!: string | null;
  @ApiProperty({ example: 'https://api.example.com/api/v1' }) apiEndpoint!: string;
  @ApiProperty({ type: BootstrapCapabilitiesDto }) capabilities!: BootstrapCapabilitiesDto;
}
