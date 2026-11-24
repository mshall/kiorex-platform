-- GRW-P3-B (attribution models, wave 7 lane A2) and GRW-P3-C (cohorts and LTV, wave 8 lane A2): aggregate-only reporting tables, schema owned by the W7 owner (lane A1).
-- Additive and idempotent. Reporting only (AD-9): nothing here is read by the attribution decision or any money path. No person identifier: sources, hashes of ordered source KINDS and counts.
-- k-anonymity is a database rule: a stored cell either has at least k = 10 people or is marked suppressed with every measure zeroed.

CREATE TABLE IF NOT EXISTS "GrowthAttributionModelResult" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "model" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL DEFAULT '',
    "conversionsFrac" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "revenueMinor" BIGINT NOT NULL DEFAULT 0,
    "paths" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthAttributionModelResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthAttributionModelResult_key" ON "GrowthAttributionModelResult"("market", "day", "model", "sourceKind", "sourceRef", "campaignId", "windowDays");
CREATE INDEX IF NOT EXISTS "GrowthAttributionModelResult_day_model_idx" ON "GrowthAttributionModelResult"("day", "model");

CREATE TABLE IF NOT EXISTS "GrowthPathSnapshot" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "pathHash" TEXT NOT NULL,
    "pathKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "length" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "k" INTEGER NOT NULL DEFAULT 10,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    CONSTRAINT "GrowthPathSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthPathSnapshot_key" ON "GrowthPathSnapshot"("market", "day", "pathHash", "windowDays");

CREATE TABLE IF NOT EXISTS "GrowthCohortMonthly" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "cohortMonth" DATE NOT NULL,
    "cohortBasis" TEXT NOT NULL DEFAULT 'FIRST_COMPLETED',
    "sourceKind" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "monthIndex" INTEGER NOT NULL,
    "patients" INTEGER NOT NULL DEFAULT 0,
    "retainedPatients" INTEGER NOT NULL DEFAULT 0,
    "completedBookings" INTEGER NOT NULL DEFAULT 0,
    "revenueMinor" BIGINT NOT NULL DEFAULT 0,
    "rewardCostMinor" BIGINT NOT NULL DEFAULT 0,
    "k" INTEGER NOT NULL DEFAULT 10,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthCohortMonthly_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthCohortMonthly_key" ON "GrowthCohortMonthly"("market", "cohortMonth", "cohortBasis", "sourceKind", "campaignId", "platform", "monthIndex");
CREATE INDEX IF NOT EXISTS "GrowthCohortMonthly_market_cohortMonth_idx" ON "GrowthCohortMonthly"("market", "cohortMonth");

CREATE TABLE IF NOT EXISTS "GrowthLtvEstimate" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "cohortKey" TEXT NOT NULL,
    "horizonMonths" INTEGER NOT NULL,
    "estimateMinor" BIGINT NOT NULL,
    "lowMinor" BIGINT NOT NULL,
    "highMinor" BIGINT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "n" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'ESTIMATE',
    CONSTRAINT "GrowthLtvEstimate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthLtvEstimate_key" ON "GrowthLtvEstimate"("market", "cohortKey", "horizonMonths", "modelVersion");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('GrowthAttributionModelResult', 'GrowthAttributionModelResult_model_check', '"model" IN (''LAST_TOUCH'',''LAST_NON_DIRECT'',''FIRST_TOUCH'',''LINEAR'',''TIME_DECAY'',''POSITION_BASED'',''DATA_DRIVEN'')'),
    ('GrowthAttributionModelResult', 'GrowthAttributionModelResult_values_check', '"conversionsFrac" >= 0 AND "revenueMinor" >= 0 AND "paths" >= 0 AND "windowDays" BETWEEN 1 AND 365'),
    ('GrowthPathSnapshot', 'GrowthPathSnapshot_k_check', '"k" >= 10 AND "conversions" >= "k" AND "length" >= 1'),
    ('GrowthCohortMonthly', 'GrowthCohortMonthly_k_check', '"k" >= 10 AND ("suppressed" OR "patients" >= "k")'),
    ('GrowthCohortMonthly', 'GrowthCohortMonthly_suppressed_check', 'NOT "suppressed" OR ("patients" = 0 AND "retainedPatients" = 0 AND "completedBookings" = 0 AND "revenueMinor" = 0 AND "rewardCostMinor" = 0)'),
    ('GrowthCohortMonthly', 'GrowthCohortMonthly_values_check', '"monthIndex" >= 0 AND "patients" >= 0 AND "retainedPatients" BETWEEN 0 AND "patients" AND "completedBookings" >= 0 AND "revenueMinor" >= 0 AND "rewardCostMinor" >= 0'),
    ('GrowthCohortMonthly', 'GrowthCohortMonthly_basis_check', '"cohortBasis" IN (''FIRST_COMPLETED'',''REGISTRATION'')'),
    ('GrowthLtvEstimate', 'GrowthLtvEstimate_n_check', '"n" >= 10 AND "horizonMonths" BETWEEN 1 AND 60'),
    ('GrowthLtvEstimate', 'GrowthLtvEstimate_interval_check', '"lowMinor" <= "estimateMinor" AND "estimateMinor" <= "highMinor"'),
    ('GrowthLtvEstimate', 'GrowthLtvEstimate_label_check', '"label" = ''ESTIMATE''')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
