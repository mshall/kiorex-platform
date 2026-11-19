import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VaultItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['VISIT_SUMMARY', 'PRESCRIPTION', 'LAB_RESULT', 'UPLOAD'] }) kind!: string;
  @ApiProperty({ nullable: true, type: String }) title!: string | null;
  @ApiProperty({ enum: ['CLINIC', 'LAB', 'PATIENT'], description: 'Where the record came from' }) source!: string;
  @ApiProperty({ nullable: true, type: String }) clinicId!: string | null;
  @ApiProperty({ nullable: true, type: String }) dependantId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) signedAt!: string | null;
  @ApiProperty() hasFile!: boolean;
  @ApiProperty({ nullable: true, type: String }) fileName!: string | null;
  @ApiProperty({ nullable: true, type: String }) mimeType!: string | null;
  @ApiProperty({ nullable: true, type: Number }) sizeBytes!: number | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class VaultListDto {
  @ApiProperty({ type: [VaultItemDto] }) items!: VaultItemDto[];
  @ApiProperty({ description: 'true when kiorex.record_vault is OFF: existing records stay readable/deletable, no uploads or new shares' }) readOnly!: boolean;
}
export class RxVerificationDto {
  @ApiProperty({ description: 'Opaque signed token' }) token!: string;
  @ApiProperty({ description: 'Encode this string as the QR code' }) qrPayload!: string;
  @ApiProperty() verifyUrl!: string;
}
export class VaultSoapDto {
  @ApiPropertyOptional({ nullable: true, type: String }) subjective?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) objective?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) assessment?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) plan?: string | null;
}
export class VaultVisitContentDto {
  @ApiPropertyOptional() encounterId?: string;
  @ApiPropertyOptional({ type: VaultSoapDto }) soap?: VaultSoapDto;
}
export class VaultRxItemDto {
  @ApiProperty() activeIngredient!: string; @ApiPropertyOptional() strength?: string; @ApiPropertyOptional() quantity?: number; @ApiPropertyOptional() directions?: string;
}
export class VaultPrescriptionDto {
  @ApiPropertyOptional() encounterId?: string; @ApiPropertyOptional() clinicId?: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) signedAt?: string | null;
  @ApiProperty({ type: [VaultRxItemDto], nullable: true, description: 'null until Kiorly shares line items (NEEDS_HUMAN #21)' }) items!: VaultRxItemDto[] | null;
  @ApiProperty() itemsAvailable!: boolean;
  @ApiPropertyOptional({ type: 'object', properties: { url: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } }, description: 'Signed expiring Rx PDF link' }) pdf?: { url: string; expiresAt: string };
}
export class VaultLabReportDto {
  @ApiProperty() reportId!: string; @ApiProperty() orderId!: string; @ApiProperty() labId!: string; @ApiProperty() reportVersion!: number;
  @ApiProperty({ format: 'date-time' }) signedAt!: string; @ApiProperty({ description: 'Signed secure link only; never raw values (KLCRIT03)' }) secureLink!: string;
}
export class VaultDetailDto extends VaultItemDto {
  @ApiPropertyOptional({ description: 'VISIT_SUMMARY: SOAP note as shared by the clinic (clinical content)', type: VaultVisitContentDto }) content?: VaultVisitContentDto;
  @ApiPropertyOptional({ description: 'PRESCRIPTION', type: VaultPrescriptionDto }) prescription?: VaultPrescriptionDto;
  @ApiPropertyOptional({ type: RxVerificationDto }) verification?: RxVerificationDto;
  @ApiPropertyOptional({ description: 'LAB_RESULT: signed report secure link (no raw values)', type: VaultLabReportDto }) report?: VaultLabReportDto;
}
export class PrescriptionItemDto extends VaultItemDto {
  @ApiProperty({ type: RxVerificationDto, description: 'QR token the patient shows at the pharmacy' }) verification!: RxVerificationDto;
}
export class RecordShareScopeDto {
  @ApiProperty({ enum: ['VISIT_SUMMARY', 'PRESCRIPTIONS', 'LAB_RESULTS', 'SHARE_WITH_OTHER_CLINICS'] }) scope!: string;
  @ApiProperty() granted!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) updatedAt!: string | null;
}
export class RecordSharingDto {
  @ApiProperty({ type: [RecordShareScopeDto] }) scopes!: RecordShareScopeDto[];
  @ApiProperty({ description: 'false when clinic.record_share_patient_app is OFF: no NEW sharing can be granted; revoking always works' }) canGrant!: boolean;
}
export class FollowUpDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) recordId!: string | null;
  @ApiProperty({ nullable: true, type: String }) clinicId!: string | null;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ enum: ['DOCTOR', 'PATIENT'] }) source!: string;
  @ApiProperty({ enum: ['SCHEDULED', 'DUE', 'CANCELLED'] }) status!: string;
}
export class RxVerifyResultDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'UNKNOWN'] }) status!: string;
  @ApiPropertyOptional() clinicId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) signedAt?: string;
}
export { OkDto } from '../common/dto';
