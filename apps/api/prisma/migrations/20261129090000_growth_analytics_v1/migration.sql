-- GRW-P1-J growth analytics v1: rollup dimensions, revenue facts, spend entries. Additive and idempotent.
ALTER TABLE "GrowthMetricDaily"
  ADD COLUMN IF NOT EXISTS "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "district" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "specialty" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "providerRef" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "doctorRef" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "branchRef" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "campaign" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "product" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "GrowthMetricDaily_market_day_metric_sourceKind_landingKind__key";
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMetricDaily_dim_key" ON "GrowthMetricDaily"("market","day","metric","sourceKind","landingKind","careType","origin","city","district","specialty","providerRef","doctorRef","branchRef","campaign","channel","platform","product");
CREATE INDEX IF NOT EXISTS "GrowthMetricDaily_metric_day_idx" ON "GrowthMetricDaily"("metric","day");

CREATE TABLE IF NOT EXISTS "GrowthRevenueFact" (
  "id" TEXT NOT NULL,
  "market" TEXT NOT NULL DEFAULT 'EG',
  "kind" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "bookingId" TEXT,
  "status" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "origin" TEXT NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthRevenueFact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthRevenueFact_kind_chargeId_status_key" ON "GrowthRevenueFact"("kind","chargeId","status");
CREATE INDEX IF NOT EXISTS "GrowthRevenueFact_occurredAt_idx" ON "GrowthRevenueFact"("occurredAt");
CREATE INDEX IF NOT EXISTS "GrowthRevenueFact_bookingId_idx" ON "GrowthRevenueFact"("bookingId");

CREATE TABLE IF NOT EXISTS "GrowthSpendEntry" (
  "id" TEXT NOT NULL,
  "market" TEXT NOT NULL DEFAULT 'EG',
  "day" DATE NOT NULL,
  "campaign" TEXT NOT NULL DEFAULT '',
  "channel" TEXT NOT NULL DEFAULT '',
  "sourceKind" TEXT NOT NULL DEFAULT '',
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "note" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "GrowthSpendEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GrowthSpendEntry_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "GrowthSpendEntry_maker_checker" CHECK ("decidedBy" IS NULL OR "decidedBy" <> "createdBy")
);
CREATE INDEX IF NOT EXISTS "GrowthSpendEntry_day_status_idx" ON "GrowthSpendEntry"("day","status");
