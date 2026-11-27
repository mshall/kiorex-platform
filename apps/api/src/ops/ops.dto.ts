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
  @ApiProperty({ required: false, nullable: true, type: String, description: 'KXMOP01 mirrors the profession' }) profession?: string | null;
  @ApiProperty({ required: false, enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }) careType?: string;
  @ApiProperty({ required: false, type: [String] }) serviceLocations?: string[];
  @ApiProperty({ required: false, type: [String] }) coverageDistricts?: string[];
}
export class OpsProviderListDto {
  total!: number;
  @ApiProperty({ type: [OpsProviderDto] }) items!: OpsProviderDto[];
}
export class SyncResultDto { upserted!: number; skipped!: number; refused!: number; pages!: number }
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
export class TimelineBookingDto {
  @ApiProperty() id!: string; @ApiProperty() sub!: string; @ApiProperty({ nullable: true, type: String }) dependantId!: string | null;
  @ApiProperty() providerId!: string; @ApiProperty() clinicId!: string; @ApiProperty() clinicianId!: string; @ApiProperty({ nullable: true, type: String }) tenantId!: string | null; @ApiProperty() typeId!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string; @ApiProperty({ format: 'date-time' }) endsAt!: string; @ApiProperty() status!: string; @ApiProperty() channel!: string;
  @ApiProperty({ nullable: true, type: String }) holdId!: string | null; @ApiProperty({ nullable: true, type: String }) holdExternalRef!: string | null; @ApiProperty({ nullable: true, type: String, format: 'date-time' }) holdExpiresAt!: string | null;
  @ApiProperty() callState!: string; @ApiProperty({ nullable: true, type: String }) kiorlyAppointmentId!: string | null; @ApiProperty({ nullable: true, type: String }) kiorlyPatientId!: string | null; @ApiProperty() kiorlyVersion!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) confirmationDueAt!: string | null; @ApiProperty({ nullable: true, type: String }) cancelledBy!: string | null; @ApiProperty({ nullable: true, type: String }) cancellationReason!: string | null;
  @ApiProperty({ nullable: true, type: Boolean }) depositRefundable!: boolean | null; @ApiProperty({ nullable: true, type: String }) failureCode!: string | null; @ApiProperty() depositStatus!: string; @ApiProperty() depositAmountMinor!: number; @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: Number }) feeMinor!: number | null; @ApiProperty() version!: number; @ApiProperty({ format: 'date-time' }) createdAt!: string; @ApiProperty({ format: 'date-time' }) updatedAt!: string; @ApiProperty({ nullable: true, type: String, format: 'date-time' }) terminalAt!: string | null;
}
export class TimelineEventDto {
  @ApiProperty() id!: string; @ApiProperty() bookingId!: string;
  @ApiProperty({ enum: ['INTENT', 'HOLD', 'KIORLY_CALL', 'WEBHOOK', 'PAYMENT', 'STATE', 'RECONCILE'] }) kind!: string;
  @ApiProperty({ nullable: true, type: String }) fromStatus!: string | null; @ApiProperty({ nullable: true, type: String }) toStatus!: string | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true, description: 'Free-form diagnostic detail of the step (no PHI)' }) detail!: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class RefundRowDto {
  @ApiProperty() id!: string; @ApiProperty() paymentId!: string; @ApiProperty() amountMinor!: number; @ApiProperty() reason!: string;
  @ApiProperty({ enum: ['REQUESTED', 'SETTLED', 'FAILED'] }) status!: string; @ApiProperty() idempotencyKey!: string; @ApiProperty({ nullable: true, type: String }) pspRefundRef!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string; @ApiProperty({ nullable: true, type: String, format: 'date-time' }) settledAt!: string | null;
}
export class PaymentRowDto {
  @ApiProperty() id!: string; @ApiProperty({ nullable: true, type: String }) bookingId!: string | null; @ApiProperty({ nullable: true, type: String }) payLinkToken!: string | null; @ApiProperty({ nullable: true, type: String }) sub!: string | null;
  @ApiProperty() clinicId!: string; @ApiProperty() amountMinor!: number; @ApiProperty() currency!: string; @ApiProperty() psp!: string; @ApiProperty({ nullable: true, type: String }) pspRef!: string | null; @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
  @ApiProperty({ enum: ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] }) status!: string; @ApiProperty() refundedMinor!: number; @ApiProperty() feeMinor!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) releasedAt!: string | null; @ApiProperty({ nullable: true, type: String }) releaseKind!: string | null; @ApiProperty({ nullable: true, type: String }) payoutId!: string | null;
  @ApiProperty({ enum: ['DEPOSIT', 'PHARMACY', 'LAB'] }) purpose!: string; @ApiProperty({ nullable: true, type: String }) orderRef!: string | null; @ApiProperty({ nullable: true, type: String, format: 'date-time' }) capturedAt!: string | null;
  @ApiProperty() kiorlyNotified!: boolean; @ApiProperty({ format: 'date-time' }) createdAt!: string; @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [RefundRowDto] }) refunds!: RefundRowDto[];
}
export class TimelineMessageDto {
  @ApiProperty() id!: string; @ApiProperty() channel!: string; @ApiProperty() status!: string; @ApiProperty() templateId!: string; @ApiProperty({ nullable: true, type: String, format: 'date-time' }) scheduledFor!: string | null;
}
export class TimelineWebhookDto {
  @ApiProperty() eventId!: string; @ApiProperty() type!: string; @ApiProperty() status!: string; @ApiProperty({ format: 'date-time' }) at!: string;
}
export class TimelineOutboxDto {
  @ApiProperty() id!: string; @ApiProperty() type!: string; @ApiProperty() status!: string; @ApiProperty() attempts!: number;
}
export class BookingTimelineOpsDto {
  @ApiProperty({ type: TimelineBookingDto }) booking!: TimelineBookingDto;
  @ApiProperty({ type: [TimelineEventDto] }) events!: TimelineEventDto[];
  @ApiProperty({ type: [PaymentRowDto] }) payments!: PaymentRowDto[];
  @ApiProperty({ type: [TimelineMessageDto] }) messages!: TimelineMessageDto[];
  @ApiProperty({ type: [TimelineWebhookDto] }) webhooks!: TimelineWebhookDto[];
  @ApiProperty({ type: [TimelineOutboxDto] }) outbox!: TimelineOutboxDto[];
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
export class StatusTotalDto { @ApiProperty() status!: string; @ApiProperty({ description: 'rows in this status' }) _count!: number; @ApiProperty({ type: 'object', properties: { amountMinor: { type: 'number', nullable: true } } }) _sum!: { amountMinor: number | null } }
export class PayoutRowDto {
  @ApiProperty() id!: string; @ApiProperty() payoutRef!: string; @ApiProperty() clinicId!: string; @ApiProperty() amountMinor!: number; @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['SENT', 'KIORLY_RECORDED'] }) status!: string; @ApiProperty() periodKey!: string; @ApiProperty({ type: [String] }) paymentRefs!: string[];
  @ApiProperty({ format: 'date-time' }) paidAt!: string; @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ReconRunRowDto {
  @ApiProperty() id!: string; @ApiProperty({ enum: ['PSP_DAILY', 'BOOKING_NIGHTLY'] }) kind!: string; @ApiProperty({ enum: ['OK', 'DISCREPANCIES'] }) status!: string;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Per-item mismatch records (kind-specific)' }) discrepancies!: Record<string, unknown>[];
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: { type: 'number' } }) stats!: Record<string, number> | null; @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class LedgerBalanceDto { @ApiProperty({ description: 'PSP_CLEARING, HELD:*, PAYABLE:*, REFUND_PAYABLE, PSP_FEES, MARKETPLACE_FEES' }) account!: string; @ApiProperty() debitMinor!: number; @ApiProperty() creditMinor!: number }
export class PaymentsDashboardDto {
  @ApiProperty({ type: [StatusTotalDto] }) intents!: StatusTotalDto[];
  @ApiProperty({ type: [StatusTotalDto] }) refunds!: StatusTotalDto[];
  @ApiProperty({ type: [PayoutRowDto] }) payouts!: PayoutRowDto[];
  @ApiProperty({ type: [ReconRunRowDto] }) reconciliationRuns!: ReconRunRowDto[];
  @ApiProperty({ type: [LedgerBalanceDto] }) balances!: LedgerBalanceDto[];
  @ApiProperty({ type: 'object', properties: { count: { type: 'number' }, amountMinor: { type: 'number' } }, description: 'KXMPAY07 deposits held for review' }) heldForReview!: { count: number; amountMinor: number };
}
export class HeldDepositDto {
  paymentId!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  clinicId!: string; amountMinor!: number; currency!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) heldForReviewAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) ageHours!: number | null;
  @ApiProperty({ nullable: true, type: String }) providerId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'District code only' }) district!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) abortedAt!: string | null;
}
export class ReviewDecisionDto {
  paymentId!: string;
  @ApiProperty({ enum: ['RELEASED_TO_PROVIDER', 'REFUNDED_TO_PATIENT'] }) outcome!: string;
  amountMinor!: number;
  @ApiProperty({ required: false }) refundId?: string;
}
export class HomeGateClusterDto {
  cluster!: string; homeEnabledProviders!: number; threshold!: number; met!: boolean;
  @ApiProperty(OBJ) byCareType!: Record<string, unknown>;
}
export class HomeGateMetricDto {
  @ApiProperty({ description: 'Minimum home-enabled providers per launch cluster (50)' }) threshold!: number;
  @ApiProperty({ example: 'governorate' }) clusterBasis!: string;
  @ApiProperty({ type: [HomeGateClusterDto] }) clusters!: HomeGateClusterDto[];
  anyMet!: boolean; allMet!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Human-recorded evidence state per gate (GHV1, GHV2): the metric never satisfies a gate' }) gates!: Record<string, unknown>;
  @ApiProperty({ description: 'Safety console (KXMOP12) is deployed in this API' }) safetyConsoleLive!: boolean;
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
  @ApiProperty({ description: 'KXMOP05: home-visit complaints have a 1 h SLA' }) homeVisit!: boolean;
  slaBreached!: boolean;
  @ApiProperty({ description: 'Minutes until the SLA is due (negative = overdue)' }) minutesToSla!: number;
}
export class OpsOkDto { ok!: boolean; @ApiProperty({ required: false }) status?: string }
export class LiquidityDto {
  windowDays!: number;
  listedDoctors!: number;
  liveDoctors!: number;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { status: { type: 'string' }, count: { type: 'number' } }, required: ['status', 'count'] } }) bookingsByStatus!: { status: string; count: number }[];
  @ApiProperty({ nullable: true, type: Number }) searchToBook!: number | null;
  searches!: number;
  confirmedBookings!: number;
  attended!: number;
  noShow!: number;
  @ApiProperty({ type: 'array', items: OBJ, description: 'KXMOP06 by care type and visit location' }) byCareType!: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: OBJ, description: 'KXMOP06 home-enabled providers per district' }) homeEnabledByDistrict!: Record<string, unknown>[];
  @ApiProperty(OBJ) safetyAlerts!: Record<string, unknown>;
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
