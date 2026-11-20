import { ApiProperty } from '@nestjs/swagger';

const OBJ = { type: 'object', additionalProperties: true } as const;
const DT = { type: String, format: 'date-time' } as const;

export class FamilyShareDto {
  id!: string; bookingId!: string; contactName!: string;
  @ApiProperty({ description: 'Masked phone (the number itself is encrypted and never returned)' }) phoneMasked!: string;
  @ApiProperty({ enum: ['ACTIVE', 'STOPPED', 'REVOKED'] }) status!: string;
  locale!: string;
  @ApiProperty(DT) createdAt!: string;
}
export class FamilyShareCreatedDto extends FamilyShareDto {
  @ApiProperty({ description: 'WhatsApp visit-status link; returned ONCE (only its hash is stored)' }) link!: string;
}
export class PublicVisitStatusDto {
  @ApiProperty({ nullable: true, type: String }) patientFirstName!: string | null;
  @ApiProperty(DT) startsAt!: string;
  status!: string;
  @ApiProperty({ nullable: true, type: String }) subState!: string | null;
  @ApiProperty({ type: 'array', items: OBJ }) steps!: Record<string, unknown>[];
  @ApiProperty(OBJ) eta!: Record<string, unknown>;
  @ApiProperty({ ...OBJ, nullable: true }) provider!: Record<string, unknown> | null;
  @ApiProperty({ description: 'The visit was stopped (no reason is ever shown to family)' }) stopped!: boolean;
}
export class SafetyCardDto {
  bookingId!: string;
  @ApiProperty(OBJ) provider!: Record<string, unknown>;
  assignmentPending!: boolean;
  @ApiProperty({ example: '123' }) emergencyNumber!: string;
  @ApiProperty(OBJ) reportProblem!: Record<string, unknown>;
  @ApiProperty(OBJ) familyShare!: Record<string, unknown>;
}
export class ProblemReportDto {
  id!: string; category!: string;
  @ApiProperty(DT) slaDueAt!: string;
  @ApiProperty({ description: 'true for home visits: 1 h SLA (KXMOP05)' }) homeVisit!: boolean;
  status!: string;
}
export class CarePlanVisitDto { bookingId!: string; @ApiProperty(DT) startsAt!: string; @ApiProperty(DT) endsAt!: string; status!: string; @ApiProperty({ nullable: true, type: String }) homeState!: string | null }
export class CarePlanDto {
  id!: string; providerId!: string;
  @ApiProperty({ enum: ['REQUESTED', 'CONFIRMED', 'ENDED', 'REJECTED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) district!: string | null;
  @ApiProperty({ nullable: true, ...DT }) confirmedAt!: string | null;
  @ApiProperty({ nullable: true, ...DT }) endedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) endedReason!: string | null;
  @ApiProperty(DT) createdAt!: string;
  @ApiProperty({ type: [CarePlanVisitDto], description: 'One booking with a schedule; each visit has its own status (KXMHV08)' }) visits!: CarePlanVisitDto[];
  completedVisits!: number;
}

// ── ops: KXMOP12 safety console ──
export class SafetySloDto {
  seconds!: number; @ApiProperty(DT) deadlineAt!: string;
  @ApiProperty({ nullable: true, ...DT }) deliveredAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) deliveryLagSeconds!: number | null;
  @ApiProperty({ nullable: true, type: Boolean }) met!: boolean | null;
  breached!: boolean; receiveLagSeconds!: number;
}
export class SafetyAlertDto {
  id!: string; alertId!: string;
  @ApiProperty({ enum: ['TIMER_EXPIRED', 'SOS', 'UNSAFE_ABORT'] }) kind!: string;
  @ApiProperty({ enum: ['RAISED', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  clinicId!: string;
  @ApiProperty({ nullable: true, type: String, description: 'District code only' }) district!: string | null;
  @ApiProperty(DT) raisedAt!: string; @ApiProperty(DT) receivedAt!: string;
  @ApiProperty({ type: SafetySloDto, description: '60 s delivery SLO fields' }) slo!: SafetySloDto;
  @ApiProperty(OBJ) delivery!: Record<string, unknown>;
  @ApiProperty({ nullable: true, ...DT }) acknowledgedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) acknowledgedBy!: string | null;
  @ApiProperty({ nullable: true, type: Number }) ackLagSeconds!: number | null;
  @ApiProperty({ nullable: true, ...DT }) escalatedAt!: string | null;
  escalationLevel!: number;
  @ApiProperty({ nullable: true, ...DT }) resolvedAt!: string | null;
  @ApiProperty({ description: 'Unacknowledged beyond SAFETY_ACK_ESCALATE_MINUTES (10)' }) needsEscalation!: boolean;
  ageSeconds!: number;
  @ApiProperty({ nullable: true, type: String }) providerName!: string | null;
  @ApiProperty({ nullable: true, type: String }) clinicPhone!: string | null;
  @ApiProperty({ type: 'array', items: OBJ }) actions!: Record<string, unknown>[];
}
export class SafetyAlertListDto { @ApiProperty({ type: [SafetyAlertDto] }) items!: SafetyAlertDto[] }
export class SafetySummaryDto {
  windowDays!: number; total!: number; open!: number; unacknowledged!: number; sloBreaches!: number;
  @ApiProperty({ nullable: true, type: Number }) medianDeliverySeconds!: number | null;
  @ApiProperty({ nullable: true, type: Number }) p95DeliverySeconds!: number | null;
  @ApiProperty({ type: 'array', items: OBJ }) byKind!: Record<string, unknown>[];
  unsafeAborts!: number; depositsHeldForReview!: number; deliveryMode!: string; sloSeconds!: number; ackEscalateMinutes!: number;
}
export class EscalationLogDto {
  alertId!: string; id!: string; kind!: string;
  @ApiProperty({ nullable: true, type: String }) district!: string | null;
  action!: string; actor!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty(DT) at!: string; level!: number;
}
export class UnsafeAbortDto {
  bookingId!: string; providerId!: string; clinicId!: string;
  @ApiProperty({ nullable: true, type: String }) district!: string | null;
  @ApiProperty({ nullable: true, ...DT }) abortedAt!: string | null;
  @ApiProperty({ description: 'always false (BR61)' }) noShow!: boolean;
  depositStatus!: string;
  @ApiProperty({ nullable: true, type: String }) paymentId!: string | null;
  @ApiProperty({ nullable: true, type: String }) reviewState!: string | null;
  amountMinor!: number;
}
export class SweepSafetyDto { retried!: number; escalated!: number }
