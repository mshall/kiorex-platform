import { ApiProperty } from '@nestjs/swagger';

export class MarketDto {
  @ApiProperty({ example: 'EG' }) code!: string;
  @ApiProperty() live!: boolean;
  @ApiProperty({ example: 'market.eg.live' }) flag!: string;
  @ApiProperty({ description: 'LIVE or the reason it is not (AWAITING_GATE, OFF_GLOBAL, ...)' }) state!: string;
}
