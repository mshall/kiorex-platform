import { ApiProperty } from '@nestjs/swagger';

export class LiveDto { @ApiProperty({ example: 'ok' }) status!: string }
export class ProviderStatusDto {
  @ApiProperty({ example: 'whatsapp' }) provider!: string;
  @ApiProperty({ enum: ['mock', 'real'] }) mode!: string;
  @ApiProperty({ example: 'meta' }) vendor!: string;
  @ApiProperty({ description: 'All required variables for the active mode are present' }) ready!: boolean;
}
export class ReadyDto {
  @ApiProperty({ example: 'ready' }) status!: string;
  @ApiProperty({ example: 'up' }) db!: string;
  @ApiProperty({ type: [ProviderStatusDto] }) providers!: ProviderStatusDto[];
}
