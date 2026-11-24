import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shapes of the organisation import console (ops). No row data, no PHI: ids, statuses and counts only. */
export class ImportBatchDto {
  @ApiProperty() id!: string; @ApiProperty({ description: 'Target Kiorly Clinic organisation id' }) orgId!: string; @ApiProperty() orgName!: string; @ApiPropertyOptional({ nullable: true }) label?: string | null;
  @ApiProperty({ enum: ['DRAFT', 'NEEDS_REVIEW', 'READY', 'AWAITING_APPROVAL', 'APPROVED', 'COMMITTING', 'COMMIT_FAILED', 'COMMITTED', 'ROLLING_BACK', 'ROLLED_BACK'] }) status!: string;
  @ApiProperty() createdBy!: string; @ApiPropertyOptional({ nullable: true }) requestedBy?: string | null; @ApiPropertyOptional({ nullable: true }) approvedBy?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'sha256 of the dry-run report the approver signed off' }) reportHash?: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Last analysis: classification, mappings, stats (no row data)' }) summary!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Per-entity committed counts, last error code' }) progress!: Record<string, unknown> | null;
  @ApiProperty() createdAt!: string; @ApiProperty() updatedAt!: string;
}
export class ImportFileViewDto {
  @ApiProperty() id!: string; @ApiProperty() name!: string; @ApiProperty() kind!: string; @ApiPropertyOptional({ nullable: true }) rejectReason?: string | null;
  @ApiProperty() size!: number; @ApiProperty() sha256!: string; @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) meta!: Record<string, unknown> | null; @ApiProperty() createdAt!: string;
}
export class ImportBatchDetailDto extends ImportBatchDto { @ApiProperty({ type: [ImportFileViewDto] }) files!: ImportFileViewDto[] }
export class ImportUploadResultDto { @ApiProperty() id!: string; @ApiProperty({ description: 'File class, or REJECTED with rejectReason' }) kind!: string; @ApiPropertyOptional() rejectReason?: string }
export class ImportRescanDto { @ApiProperty() ok!: boolean; @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) stats!: Record<string, unknown> | null }
export class ImportTaskCountDto { @ApiProperty() status!: string; @ApiProperty() severity!: string; @ApiProperty() count!: number }
export class ImportTaskDto {
  @ApiProperty() id!: string; @ApiProperty({ enum: ['OPEN', 'RESOLVED', 'IGNORED'] }) status!: string; @ApiPropertyOptional({ nullable: true }) resolvedBy?: string | null;
  @ApiProperty({ description: 'The task payload (type, severity, entity, options); never row values' }) type!: string; @ApiProperty({ enum: ['BLOCKER', 'WARNING', 'INFO'] }) severity!: string;
}
export class ImportTaskPageDto {
  @ApiProperty() total!: number; @ApiProperty() page!: number; @ApiProperty() pageSize!: number;
  @ApiProperty({ type: [ImportTaskCountDto] }) counts!: ImportTaskCountDto[]; @ApiProperty({ type: [ImportTaskDto] }) items!: ImportTaskDto[];
}
export class ImportResolveManyDto { @ApiProperty() ok!: boolean; @ApiProperty({ description: 'Tasks resolved' }) resolved!: number }
export class ImportResolveDto { @ApiProperty() ok!: boolean; @ApiProperty({ description: 'Open tasks left' }) open!: number }
export class ImportPatientHitDto { @ApiProperty() sourceKey!: string; @ApiPropertyOptional({ nullable: true }) name?: string | null; @ApiPropertyOptional({ nullable: true }) phone?: string | null }
export class ImportTaskBreakdownDto { @ApiProperty() type!: string; @ApiProperty() status!: string; @ApiProperty() count!: number }
export class ImportDryRunDto {
  @ApiProperty() batchId!: string; @ApiProperty() status!: string; @ApiPropertyOptional() orgId?: string; @ApiPropertyOptional() orgName?: string;
  @ApiPropertyOptional({ description: 'sha256 of the report: what the approver signs off' }) reportHash?: string; @ApiPropertyOptional() canCommit?: boolean;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Rows per entity that would be created' }) willCreate?: Record<string, number>;
  @ApiPropertyOptional() filesToAttach?: number; @ApiPropertyOptional() mergedPatients?: number; @ApiPropertyOptional() skippedFiles?: number;
  @ApiPropertyOptional() openBlockers?: number; @ApiPropertyOptional() openWarnings?: number; @ApiPropertyOptional() ignoredWithReason?: number;
  @ApiPropertyOptional({ type: [ImportTaskBreakdownDto] }) taskBreakdown?: ImportTaskBreakdownDto[]; @ApiPropertyOptional() targetMode?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Committed batches only: the per-entity progress' }) progress?: Record<string, unknown> | null;
}
export class ImportRequestedDto { @ApiProperty() ok!: boolean; @ApiPropertyOptional() reportHash?: string; @ApiPropertyOptional({ type: 'object', additionalProperties: true }) committed?: Record<string, unknown>; @ApiPropertyOptional() removed?: number }
export class ImportAuditLineDto {
  @ApiProperty() id!: string; @ApiProperty() actor!: string; @ApiProperty() action!: string; @ApiProperty() resource!: string; @ApiPropertyOptional({ nullable: true }) resourceId?: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Ids and counts only' }) metadata!: Record<string, unknown> | null; @ApiProperty() createdAt!: string;
}
