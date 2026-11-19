import { ApiProperty } from '@nestjs/swagger';

export class MeDto {
  @ApiProperty({ description: 'Kiorex Passport subject' }) sub!: string;
  @ApiProperty({ type: [String], description: 'kx_roles claim: patient, ops_admin, super_admin' }) roles!: string[];
  @ApiProperty({ required: false }) phone?: string;
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ required: false }) locale?: string;
}
export class LogoutResultDto { ok!: boolean }
