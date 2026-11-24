import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shapes of partner onboarding (ops console and the partner's own intake). No secrets, no PHI. */
export class EnrolmentViewDto {
  @ApiProperty({ example: 'kxe_ab12cd34' }) id!: string; @ApiProperty({ enum: ['CLINIC', 'NURSE', 'PHARMACY', 'LAB'] }) kind!: string; @ApiPropertyOptional({ nullable: true }) orgRef?: string | null; @ApiProperty() label!: string;
  @ApiProperty({ enum: ['ACTIVE', 'USED', 'REVOKED', 'EXPIRED'] }) status!: string; @ApiProperty() expiresAt!: string; @ApiProperty() createdBy!: string;
  @ApiPropertyOptional({ nullable: true }) revokedBy?: string | null; @ApiPropertyOptional({ nullable: true }) revokedAt?: string | null; @ApiPropertyOptional({ nullable: true }) usedAt?: string | null; @ApiPropertyOptional({ nullable: true }) connectionId?: string | null; @ApiProperty() createdAt!: string;
}
export class EnrolmentCreatedDto extends EnrolmentViewDto {
  @ApiProperty({ description: 'The one-time enrolment code (kxe_<id>.<secret>); only ever present in this response' }) code!: string; @ApiProperty({ example: true }) shownOnce!: boolean;
}
export class IntakeResultDto {
  @ApiProperty({ example: 'pc_ab12cd34' }) id!: string; @ApiProperty() status!: string; @ApiProperty({ description: 'true on the first submission, false on a re-submit' }) created!: boolean;
  @ApiPropertyOptional({ description: 'Status-poll token, shown once on creation (not returned when the partner supplied its own)' }) statusToken?: string;
  @ApiPropertyOptional({ description: 'Intake key kxi_..., shown once: on creation and after a recovery re-enrolment' }) intakeKey?: string;
}
export class PartnerStepDto {
  @ApiProperty() key!: string; @ApiProperty({ enum: ['AUTO', 'HUMAN'] }) type!: string; @ApiProperty({ enum: ['DONE', 'FAILED', 'WARN', 'PENDING', 'ACTION', 'LOCKED'] }) state!: string;
  @ApiPropertyOptional() code?: string; @ApiPropertyOptional({ type: 'object', additionalProperties: true }) detail?: Record<string, unknown>; @ApiPropertyOptional({ enum: ['ops_admin', 'super_admin'], description: 'HUMAN steps: who may act' }) actor?: string; @ApiPropertyOptional() link?: string;
}
export class PartnerPublicStepDto { @ApiProperty() key!: string; @ApiProperty({ enum: ['AUTO', 'HUMAN'] }) type!: string; @ApiProperty() state!: string }
export class PartnerPublicStatusDto {
  @ApiProperty() id!: string; @ApiProperty() kind!: string; @ApiProperty() status!: string; @ApiPropertyOptional({ nullable: true }) decisionReason?: string | null; @ApiProperty() progress!: number;
  @ApiProperty({ type: [PartnerPublicStepDto], description: 'key, type and state only (no internal detail)' }) steps!: PartnerPublicStepDto[]; @ApiPropertyOptional({ nullable: true }) liveAt?: string | null; @ApiProperty() updatedAt!: string;
}
export class PartnerConnectionRowDto {
  @ApiProperty() id!: string; @ApiProperty() kind!: string; @ApiProperty() name!: string; @ApiPropertyOptional({ nullable: true }) nameAr?: string | null; @ApiProperty() market!: string; @ApiProperty() status!: string;
  @ApiProperty({ description: 'Percent of steps done (0-100)' }) progress!: number; @ApiProperty({ type: [String], description: 'Human step keys waiting for ops' }) humanActions!: string[]; @ApiProperty() createdAt!: string; @ApiProperty() updatedAt!: string;
}
export class PartnerConnectionDto extends PartnerConnectionRowDto {
  @ApiProperty() orgRef!: string; @ApiPropertyOptional({ nullable: true }) baseUrl?: string | null; @ApiPropertyOptional({ nullable: true }) clientKey?: string | null; @ApiPropertyOptional({ nullable: true }) decisionReason?: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The partner\'s own readiness answers (no secrets)' }) readiness!: Record<string, unknown>; @ApiPropertyOptional({ nullable: true }) checksRunAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) requestedBy?: string | null; @ApiPropertyOptional({ nullable: true }) approvedBy?: string | null; @ApiPropertyOptional({ nullable: true }) liveAt?: string | null;
  @ApiProperty() rotationPending!: boolean; @ApiProperty({ type: [PartnerStepDto] }) steps!: PartnerStepDto[]; @ApiProperty({ type: [String], description: 'Reasons go-live is still blocked' }) blockers!: string[];
}
export class PartnerAuditLineDto {
  @ApiProperty() id!: string; @ApiProperty() actor!: string; @ApiProperty({ description: 'e.g. submitted, approved, go_live' }) action!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Ids and codes only' }) metadata!: Record<string, unknown> | null; @ApiProperty() createdAt!: string;
}
