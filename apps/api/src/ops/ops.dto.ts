import { ApiProperty } from '@nestjs/swagger';

/** Loose object helper: ops rows mirror DB rows; the documented fields below are the stable contract for the console. */
const OBJ = { type: 'object', additionalProperties: true } as const;

export class OpsProviderDto {
  id!: string;
  clinicId!: string;
  clinicianId!: string;
  @ApiProperty({ description: 'Mirrored Kiorly listing status (LIVE, PAUSED, ...)' }) status!: string;
  @ApiProperty({ nullable: true, type: String }) nameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) nameAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) specialty!: string | null;
  @ApiProperty({ required: false, format: 'date-time' }) syncedAt?: string;
}
export class OpsProviderListDto {
  total!: number;
  @ApiProperty({ type: [OpsProviderDto] }) items!: OpsProviderDto[];
}
export class SyncResultDto { upserted!: number; skipped!: number; pages!: number }
export class OpsBookingDto {
  id!: string;
  providerId!: string;
  clinicId!: string;
  @ApiProperty({ enum: ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  callState!: string;
  depositStatus!: string;
  @ApiProperty({ nullable: true, type: String }) failureCode!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class BookingTimelineOpsDto {
  @ApiProperty(OBJ) booking!: Record<string, unknown>;
  @ApiProperty({ type: 'array', items: OBJ, description: 'BookingEvent rows: INTENT, HOLD, KIORLY_CALL, WEBHOOK, PAYMENT, STATE, RECONCILE' }) events!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) payments!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) messages!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) webhooks!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) outbox!: Record<string, unknown>[];
}
export class OutboxEventDto {
  id!: string;
  type!: string;
  aggregateType!: string;
  aggregateId!: string;
  target!: string;
  @ApiProperty({ enum: ['PENDING', 'SENT', 'FAILED', 'DEAD'] }) status!: string;
  attempts!: number;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty({ format: 'date-time' }) nextAttemptAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) sentAt!: string | null;
}
export class OutboxStatsDto {
  pending!: number;
  failed!: number;
  dead!: number;
  @ApiProperty({ description: 'Age of the oldest undelivered event in ms' }) lagMs!: number;
  @ApiProperty({ description: 'true when lag exceeds 2 minutes' }) lagAlert!: boolean;
}
export class OutboxListDto {
  @ApiProperty({ type: OutboxStatsDto }) stats!: OutboxStatsDto;
  @ApiProperty({ type: [OutboxEventDto] }) items!: OutboxEventDto[];
}
export class ReplayResultDto { ok!: boolean; @ApiProperty({ required: false }) status?: string }
export class PaymentsDashboardDto {
  @ApiProperty({ type: 'array', items: OBJ }) intents!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) refunds!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) payouts!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ }) reconciliationRuns!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ, description: 'Ledger balances per account (PSP_CLEARING, HELD:*, PAYABLE:*, REFUND_PAYABLE, PSP_FEES, MARKETPLACE_FEES)' }) balances!: Record<string, unknown>[];
}
export class RefundDto {
  id!: string;
  paymentId!: string;
  amountMinor!: number;
  reason!: string;
  @ApiProperty({ enum: ['REQUESTED', 'SETTLED', 'FAILED'] }) status!: string;
}
export class FeeStatementLineDto {
  @ApiProperty({ description: 'Ledger partner account owner, e.g. ph:<pharmacyId> or lab:<labId>' }) partner!: string;
  orders!: number;
  feeMinor!: number;
  vatBps!: number;
  vatMinor!: number;
  totalMinor!: number;
}
export class FeeStatementTotalsDto { feeMinor!: number; vatMinor!: number; totalMinor!: number }
export class FeeStatementDto {
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  currency!: string;
  @ApiProperty({ description: 'VAT is a config line on Kiorex\'s own statements (FEE_STATEMENT_VAT_BPS, NEEDS_HUMAN). Never reported to any authority.' }) vatBps!: number;
  vatNote!: string;
  @ApiProperty({ type: [FeeStatementLineDto] }) lines!: FeeStatementLineDto[];
  @ApiProperty({ type: FeeStatementTotalsDto }) totals!: FeeStatementTotalsDto;
}
export class PayoutRunDto {
  period!: string;
  @ApiProperty({ type: 'array', items: OBJ }) payouts!: Record<string, unknown>[];
}
export class ReconciliationRunDto {
  id!: string;
  @ApiProperty({ enum: ['PSP_DAILY', 'BOOKING_NIGHTLY'] }) kind!: string;
  @ApiProperty({ enum: ['OK', 'DISCREPANCIES'] }) status!: string;
  @ApiProperty({ type: 'array', items: OBJ }) discrepancies!: Record<string, unknown>[];
  @ApiProperty({ ...OBJ, nullable: true }) stats!: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ImportResultDto { imported!: number }
export class BookingReconcileDto { @ApiProperty({ ...OBJ, description: 'checked / corrected / missing / errors counters' }) result!: Record<string, unknown> }
export class ModerationCaseDto {
  id!: string;
  reviewId!: string;
  reason!: string;
  @ApiProperty({ enum: ['OPEN', 'RESOLVED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) resolution!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ComplaintDto {
  id!: string;
  sub!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  category!: string;
  status!: string;
  @ApiProperty({ format: 'date-time' }) slaDueAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class OpsOkDto { ok!: boolean; @ApiProperty({ required: false }) status?: string }
export class LiquidityDto {
  windowDays!: number;
  listedDoctors!: number;
  liveDoctors!: number;
  @ApiProperty({ type: 'array', items: OBJ }) bookingsByStatus!: Record<string, unknown>[];
  @ApiProperty({ nullable: true, type: Number }) searchToBook!: number | null;
  searches!: number;
  confirmedBookings!: number;
  attended!: number;
  noShow!: number;
}
export class CircuitDto {
  clinicId!: string;
  fails!: number;
  open!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) openUntil!: string | null;
}
export class OpsMessageDto {
  id!: string;
  sub!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  channel!: string;
  templateId!: string;
  status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class AuditLogDto {
  id!: string;
  actor!: string;
  action!: string;
  resource!: string;
  @ApiProperty({ nullable: true, type: String }) resourceId!: string | null;
  @ApiProperty({ ...OBJ, nullable: true }) metadata!: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
