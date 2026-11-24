import { CAMPAIGN_CHANNELS, CAMPAIGN_PAUSE_REASONS, CAMPAIGN_STATES } from '@kiorex/contracts';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const CHANNELS = [...CAMPAIGN_CHANNELS]; const STATES = [...CAMPAIGN_STATES]; const PAUSE = [...CAMPAIGN_PAUSE_REASONS];
export const OBJECTIVES = ['AWARENESS', 'ACQUISITION', 'REACTIVATION', 'PROMOTION', 'APP_INSTALL', 'PROVIDER_GROWTH'] as const;

export class CreateCampaignDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,47}$/) key!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsIn([...OBJECTIVES]) objective!: (typeof OBJECTIVES)[number];
  @IsOptional() @Matches(/^[A-Z]{2}$/) market?: string;
  @IsInt() @Min(1) @Max(2_000_000_000) budgetTotalMinor!: number;
  @IsOptional() @IsInt() @Min(1) @Max(2_000_000_000) budgetDailyMinor?: number;
  @IsArray() @ArrayMaxSize(12) @IsIn(CHANNELS, { each: true }) channels!: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsObject() eligibility?: Record<string, unknown>;
  @IsOptional() @IsObject() utmConfig?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(64) landingPageId?: string;
}

export class UpdateCampaignDto {
  @IsInt() @Min(1) version!: number; // optimistic lock: the version the editor loaded
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsIn([...OBJECTIVES]) objective?: (typeof OBJECTIVES)[number];
  @IsOptional() @IsInt() @Min(1) @Max(2_000_000_000) budgetTotalMinor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2_000_000_000) budgetDailyMinor?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsIn(CHANNELS, { each: true }) channels?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsObject() eligibility?: Record<string, unknown>;
  @IsOptional() @IsObject() utmConfig?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(64) landingPageId?: string;
}

export class TransitionDto {
  @IsIn(STATES) to!: string;
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,63}$/) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsIn(PAUSE) pauseReason?: string;
}

export class RequestApprovalDto {
  @IsIn(['ACTIVATE', 'BUDGET_INCREASE', 'REACTIVATE']) kind!: 'ACTIVATE' | 'BUDGET_INCREASE' | 'REACTIVATE';
  /** BUDGET_INCREASE: the new totals to apply on approval. */
  @IsOptional() @IsInt() @Min(1) @Max(2_000_000_000) budgetTotalMinor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2_000_000_000) budgetDailyMinor?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  /** The payload hash the decider reviewed: a decision on a stale snapshot is refused. */
  @IsString() @Matches(/^[0-9a-f]{64}$/) snapshotHash!: string;
}

export class AddCreativeDto {
  @IsIn(['IMAGE', 'VIDEO', 'COPY', 'LANDING', 'LINK']) kind!: string;
  @IsString() @MinLength(3) @MaxLength(500) assetRef!: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) checksum?: string;
}

export class CampaignSpendDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) amountMinor!: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
