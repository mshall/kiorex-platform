import { ApiProperty } from '@nestjs/swagger';

export class LiveDto { @ApiProperty({ example: 'ok' }) status!: string }
export class ReadyDto {
  @ApiProperty({ example: 'ready' }) status!: string;
  @ApiProperty({ example: 'up' }) db!: string;
}
