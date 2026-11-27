import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const OBJ = { type: 'object', additionalProperties: true } as const;

export class FlagEffectiveDto {
  enabled!: boolean;
  @ApiProperty({ enum: ['ON', 'OFF_GLOBAL', 'OFF_MARKET', 'OFF_ORG', 'AWAITING_GATE', 'DEPENDENCY_OFF', 'UNKNOWN_FLAG'] }) reason!: string;
  @ApiProperty({ required: false, enum: ['GLOBAL', 'MARKET', 'ORG', 'COHORT', 'GATE', 'DEPENDENCY'] }) scope?: string;
}
export class EffectiveFlagsDto {
  @ApiProperty({ example: 'EG' }) market!: string;
  version!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'object', required: ['enabled', 'reason'], properties: { enabled: { type: 'boolean' }, reason: { type: 'string' }, scope: { type: 'string' } } }, description: 'Map of Kiorex flag key -> effective state (hide entry points when enabled=false)' }) flags!: Record<string, FlagEffectiveDto>;
}
export class SnapshotFlagValuesDto {
  @ApiProperty({ required: false, enum: ['OFF'] }) global?: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) markets!: Record<string, string>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) orgs!: Record<string, string>;
}
export class SnapshotFlagDto {
  key!: string;
  class!: string;
  @ApiProperty({ type: [String] }) scopes!: string[];
  @ApiProperty({ type: [String] }) dependsOn!: string[];
  launchLocked!: boolean;
  gateSatisfied!: boolean;
  @ApiProperty({ type: SnapshotFlagValuesDto }) values!: SnapshotFlagValuesDto;
  @ApiProperty({ required: false, format: 'date-time' }) expiresAt?: string;
}
export class FlagSnapshotDto {
  product!: string;
  version!: number;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: [SnapshotFlagDto] }) flags!: SnapshotFlagDto[];
  @ApiProperty({ description: 'base64url HMAC-SHA256 over the sorted-key JSON of the snapshot without this field' }) signature!: string;
}
export class FlagEffectiveMapDto {
  @ApiProperty() global!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' }, description: 'market code -> effective' }) market!: Record<string, boolean>;
}
export class FlagSourceDto {
  @ApiProperty({ enum: ['GLOBAL', 'MARKET', 'ORG', 'COHORT', 'GATE', 'DEPENDENCY', 'DEFAULT'] }) scope!: string;
  @ApiPropertyOptional() scopeId?: string;
  @ApiPropertyOptional({ nullable: true, type: String }) reason?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) ticket?: string | null;
  @ApiPropertyOptional() setBy?: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) expiresAt?: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) at?: string;
  @ApiPropertyOptional({ description: 'DEPENDENCY: the flag that is OFF' }) blockedBy?: string;
}
export class FlagOverrideDto {
  @ApiProperty() scope!: string; @ApiProperty() scopeId!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null; @ApiProperty({ nullable: true, type: String }) ticket!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) expiresAt!: string | null; @ApiProperty({ nullable: true, type: String, format: 'date-time' }) startsAt!: string | null;
}
export class FlagGateDto {
  @ApiProperty() gateId!: string; @ApiProperty() approver!: string;
  @ApiProperty({ format: 'date-time' }) approvedOn!: string; @ApiProperty() documentUrl!: string;
}
export class FlagLastChangeDto {
  @ApiProperty({ format: 'date-time' }) at!: string; @ApiProperty() actor!: string;
  @ApiProperty({ enum: ['TOGGLE', 'GATE', 'EXPIRY', 'REQUEST', 'APPROVE', 'REVIEW'] }) event!: string; @ApiProperty() newValue!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
}
export class AdminFlagDto {
  key!: string;
  product!: string;
  class!: string;
  @ApiProperty({ type: [String] }) scopes!: string[];
  @ApiProperty({ type: [String] }) dependsOn!: string[];
  moneyPath!: boolean;
  launchLocked!: boolean;
  @ApiProperty({ nullable: true, type: String }) whenOff!: string | null;
  @ApiProperty({ nullable: true, type: String }) gateHint!: string | null;
  @ApiProperty({ type: FlagEffectiveMapDto }) effective!: FlagEffectiveMapDto;
  @ApiProperty({ enum: ['ON', 'ON_AWAITING_GATE', 'OFF'] }) state!: string;
  reason!: string;
  @ApiProperty({ type: FlagSourceDto }) source!: FlagSourceDto;
  @ApiProperty({ type: [FlagOverrideDto] }) overrides!: FlagOverrideDto[];
  @ApiProperty({ type: FlagGateDto, nullable: true, description: 'Launch-gate evidence recorded by a human; null until then (first row when several gates are required)' }) gate!: FlagGateDto | null;
  @ApiProperty({ type: [String], description: 'Gate ids that must ALL have evidence (e.g. GHV1, GHV2); empty = any single evidence row' }) gateIds!: string[];
  @ApiProperty({ nullable: true, type: String, description: 'NURSE for nurse.* keys (served in the kiorly-clinic snapshot)' }) edition!: string | null;
  @ApiProperty({ type: [FlagGateDto], description: 'Every gate evidence row recorded for this flag' }) gates!: FlagGateDto[];
  @ApiProperty({ type: [String], description: 'Launch-locked flags: gate ids still without evidence (ANY when no gate id is listed and none recorded)' }) missingGates!: string[];
  @ApiProperty({ type: FlagLastChangeDto, nullable: true }) lastChange!: FlagLastChangeDto | null;
}
export class SetFlagResultDto {
  @ApiProperty({ enum: ['APPLIED', 'PENDING_APPROVAL'] }) status!: string;
  @ApiProperty({ required: false }) requestId?: string;
  @ApiProperty({ required: false }) version?: number;
}
export class VersionDto { version!: number }
export class FlagDefinitionDto {
  key!: string;
  product!: string;
  class!: string;
  @ApiProperty({ type: [String] }) scopes!: string[];
  @ApiProperty({ type: [String] }) dependsOn!: string[];
  launchLocked!: boolean;
  moneyPath!: boolean;
  description!: string;
}
export class FlagChangeRequestDto {
  id!: string;
  flagKey!: string;
  scope!: string;
  scopeId!: string;
  @ApiProperty({ enum: ['ON', 'OFF'] }) value!: string;
  reason!: string;
  ticket!: string;
  requestedBy!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: string;
  emergency!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) reviewDueAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) expiresAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) approvedBy!: string | null;
  @ApiProperty({ nullable: true, type: String }) reviewedBy!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) reviewedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) decidedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class FlagAuditDto {
  id!: string;
  flagKey!: string;
  scope!: string;
  scopeId!: string;
  @ApiProperty({ nullable: true, type: String }) oldValue!: string | null;
  newValue!: string;
  actor!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ nullable: true, type: String }) ticket!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) expiresAt!: string | null;
  emergency!: boolean;
  @ApiProperty({ enum: ['TOGGLE', 'GATE', 'EXPIRY', 'REQUEST', 'APPROVE', 'REVIEW'] }) event!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class PropagationProductDto {
  product!: string;
  snapshotVersion!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastFetchedAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) ageSeconds!: number | null;
  versionsBehind!: number;
  @ApiProperty({ enum: ['NEVER_FETCHED', 'IN_SYNC', 'STALE', 'PROPAGATING'] }) status!: string;
  @ApiProperty(OBJ) lastPush!: Record<string, unknown>;
  webhookConfigured!: boolean;
}
export class PropagationDto {
  currentVersion!: number;
  @ApiProperty({ type: [PropagationProductDto] }) products!: PropagationProductDto[];
}
export class ProductRegistrationDto {
  product!: string;
  @ApiProperty({ nullable: true, type: String }) webhookUrl!: string | null;
  active!: boolean;
}
export class SweepResultDto { expired!: number; started!: number }
export class RequestDecisionDto { @ApiProperty({ enum: ['APPROVED', 'REJECTED', 'REVIEWED'] }) status!: string; @ApiProperty({ required: false }) version?: number }

export class GateFlagDto {
  key!: string;
  @ApiProperty({ type: [String] }) requiredGates!: string[];
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: 'Evidence recorded by a human for this flag + gate; null until then' }) evidence!: Record<string, unknown> | null;
}
export class GateEntryDto {
  gateId!: string;
  @ApiProperty({ type: [GateFlagDto] }) flags!: GateFlagDto[];
}
export class GateBoardDto { @ApiProperty({ type: [GateEntryDto] }) gates!: GateEntryDto[] }
export class GateRecordedDto {
  gateId!: string;
  @ApiProperty({ type: [String] }) flags!: string[];
  version!: number;
}
