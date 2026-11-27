import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Common to every change: a reason is mandatory (checked again by the Clinic, which owns the rule); approval reference and link are recorded in the market audit trail. */
class DecisionFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1200) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) approvalRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) approvalLink?: string;
}
export class MarketTransitionBody extends DecisionFields {
  /** Pause only: days (1 to 365, whole number); the Clinic validates the value. */
  @ApiPropertyOptional() @Allow() days?: unknown;
}
export class MarketCreateBody extends DecisionFields {
  @IsString() @MaxLength(16) code!: string;
  @IsOptional() @IsString() @MaxLength(300) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(300) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(16) defaultCurrency?: string;
  @IsOptional() @IsString() @MaxLength(80) defaultTimezone?: string;
  @IsOptional() @IsString() @MaxLength(16) defaultLocale?: string;
  @IsOptional() @IsString() @MaxLength(8) defaultPhoneRegion?: string;
  @IsOptional() @IsArray() weekendDays?: unknown[];
  @IsOptional() @IsArray() enabledLanguages?: unknown[];
  @IsOptional() @IsString() @MaxLength(40) dataRegion?: string;
  @IsOptional() @IsString() @MaxLength(80) hostCell?: string;
}
export class MarketTaxPackBody extends DecisionFields {
  @IsNumber() invoiceVatPercent!: number;
  @IsNumber() saasVatPercent!: number;
  @IsNumber() defaultVisitFee!: number;
  @IsOptional() @IsBoolean() trnRequired?: boolean;
  @IsOptional() @IsString() @MaxLength(200) trnFormat?: string | null;
}
export class MarketLegalBody extends DecisionFields {
  @IsOptional() @IsObject() crossBorderTransfer?: Record<string, unknown>;
  @IsOptional() @IsObject() pilotException?: Record<string, unknown>;
}
export class MarketSecondApproverBody extends DecisionFields {
  @IsBoolean() requireSecondApprover!: boolean;
}
export class MarketRequestDecisionBody {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export const REQUEST_STATUS = ['PENDING', 'APPLIED', 'REJECTED', 'CANCELLED'] as const;
export class RequestStatusQuery { @IsOptional() @IsIn([...REQUEST_STATUS]) status?: string }
