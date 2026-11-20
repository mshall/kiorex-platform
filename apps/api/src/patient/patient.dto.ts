import { ApiProperty } from '@nestjs/swagger';

export class PatientProfileDto {
  id!: string;
  sub!: string;
  phone!: string | null;
  email!: string | null;
  nameEn!: string | null;
  nameAr!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dateOfBirth!: string | null;
  @ApiProperty({ enum: ['MALE', 'FEMALE'], nullable: true, type: String }) gender!: string | null;
  hasNationalId!: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'National ID is never returned; last 4 digits only' }) nationalIdLast4!: string | null;
  @ApiProperty({ enum: ['ar', 'en'] }) preferredLocale!: string;
  @ApiProperty({ example: 'EG' }) market!: string;
  noShowCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class DependantDto {
  id!: string;
  guardianSub!: string;
  nameEn!: string;
  @ApiProperty({ nullable: true, type: String }) nameAr!: string | null;
  @ApiProperty({ format: 'date-time' }) dateOfBirth!: string;
  @ApiProperty({ nullable: true, type: String }) gender!: string | null;
  @ApiProperty({ enum: ['CHILD', 'PARENT', 'SPOUSE', 'OTHER'] }) relationship!: string;
  @ApiProperty({ nullable: true, type: String }) evidence!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time', description: 'Age of majority: guardian access ends' }) expiresAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) deletedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ required: false, description: 'Present on list responses' }) guardianAccessExpired?: boolean;
}
export class ConsentStateDto {
  @ApiProperty({ enum: ['MARKETPLACE_PROCESSING', 'REMINDERS', 'RECORD_SHARING', 'AI_PROCESSING', 'VISIT_STATUS_SHARING'] }) purpose!: string;
  granted!: boolean;
  @ApiProperty({ nullable: true, type: String }) version!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) updatedAt!: string | null;
}
export class ConsentRecordDto {
  id!: string;
  sub!: string;
  purpose!: string;
  granted!: boolean;
  version!: string;
  source!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ConsentSetResultDto { purpose!: string; granted!: boolean }
export class AuthSessionDto {
  id!: string;
  @ApiProperty({ nullable: true, type: String }) device!: string | null;
  @ApiProperty({ nullable: true, type: String }) clientId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastSeenAt!: string;
  current!: boolean;
}
export class KiorlyLinkDto {
  id!: string;
  sub!: string;
  @ApiProperty({ nullable: true, type: String }) dependantId!: string | null;
  clinicId!: string;
  kiorlyPatientId!: string;
  @ApiProperty({ enum: ['PHONE', 'NATIONAL_ID', 'PHONE_AND_NATIONAL_ID'] }) evidence!: string;
  @ApiProperty({ enum: ['LINKED', 'CONFLICT_REVIEW'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class DataExportDto {
  @ApiProperty({ description: 'DataRequest id' }) id!: string;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) profile!: Record<string, unknown> | null;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) dependants!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) consents!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) kiorlyLinks!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true }, required: false, description: 'Contributed by other modules (bookings, vault, pharmacyOrders, labBookings ...)' }) bookings?: Record<string, unknown>[];
}
export class DeletionResultDto {
  ok!: boolean;
  deleted!: boolean;
  @ApiProperty({ required: false }) code?: string;
  @ApiProperty({ required: false }) note?: string;
  @ApiProperty({ type: 'object', additionalProperties: true, required: false }) export?: Record<string, unknown>;
}
