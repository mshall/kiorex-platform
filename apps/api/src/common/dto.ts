import { ApiProperty } from '@nestjs/swagger';

/** Shared response shapes (kept in the shared kernel so modules need not import each other's DTOs). */
export class OkDto { @ApiProperty() ok!: boolean }
