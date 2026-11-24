-- GRW-P2-X1 (wave 5, contracts 1.12.0): campaign management tables, spend columns, campaign metric dimension.
-- Idempotent. Append-only: GrowthCampaignStatusHistory. Maker-checker CHECK on GrowthCampaignApproval. GrowthMetricDaily moves to the superseding unique index dim2 (campaignId in the key).

-- AlterTable
ALTER TABLE "GrowthMetricDaily" ADD COLUMN IF NOT EXISTS "campaignId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "GrowthSpendEntry" ADD COLUMN IF NOT EXISTS "adapterRef" TEXT,
ADD COLUMN IF NOT EXISTS "campaignId" TEXT,
ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCampaign" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "key" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "autoExpiresAt" TIMESTAMP(3),
    "budgetTotalMinor" INTEGER NOT NULL,
    "budgetDailyMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "channels" TEXT[],
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "utmConfig" JSONB NOT NULL DEFAULT '{}',
    "landingPageId" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "ownerSub" TEXT NOT NULL,
    "approvedPayloadHash" TEXT,
    "pausedUntil" TIMESTAMP(3),
    "pauseReason" TEXT,
    "thresholdsFiredBp" INTEGER[],
    "statusReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "GrowthCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCampaignCreative" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "assetRef" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "checksum" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthCampaignCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCampaignApproval" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,

    CONSTRAINT "GrowthCampaignApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCampaignStatusHistory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthCampaignStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCampaignBudgetDaily" (
    "campaignId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "plannedMinor" INTEGER NOT NULL DEFAULT 0,
    "approvedSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "pendingSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "utilisationBp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthCampaignBudgetDaily_pkey" PRIMARY KEY ("campaignId","day")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaign_market_status_idx" ON "GrowthCampaign"("market", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaign_status_startsAt_idx" ON "GrowthCampaign"("status", "startsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaign_status_endsAt_idx" ON "GrowthCampaign"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthCampaign_market_key_key" ON "GrowthCampaign"("market", "key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthCampaign_market_utmCampaign_key" ON "GrowthCampaign"("market", "utmCampaign");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaignCreative_campaignId_idx" ON "GrowthCampaignCreative"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaignApproval_campaignId_requestedAt_idx" ON "GrowthCampaignApproval"("campaignId", "requestedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaignApproval_decision_requestedAt_idx" ON "GrowthCampaignApproval"("decision", "requestedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCampaignStatusHistory_campaignId_at_idx" ON "GrowthCampaignStatusHistory"("campaignId", "at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMetricDaily_dim2_key" ON "GrowthMetricDaily"("market", "day", "metric", "sourceKind", "landingKind", "careType", "origin", "city", "district", "specialty", "providerRef", "doctorRef", "branchRef", "campaign", "channel", "platform", "product", "campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthSpendEntry_campaignId_day_idx" ON "GrowthSpendEntry"("campaignId", "day");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthCampaignCreative_campaignId_fkey') THEN
    ALTER TABLE "GrowthCampaignCreative" ADD CONSTRAINT "GrowthCampaignCreative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthCampaignApproval_campaignId_fkey') THEN
    ALTER TABLE "GrowthCampaignApproval" ADD CONSTRAINT "GrowthCampaignApproval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthCampaignStatusHistory_campaignId_fkey') THEN
    ALTER TABLE "GrowthCampaignStatusHistory" ADD CONSTRAINT "GrowthCampaignStatusHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthCampaignBudgetDaily_campaignId_fkey') THEN
    ALTER TABLE "GrowthCampaignBudgetDaily" ADD CONSTRAINT "GrowthCampaignBudgetDaily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- DropIndex (superseded by GrowthMetricDaily_dim2_key above)
DROP INDEX IF EXISTS "GrowthMetricDaily_dim_key";

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('GrowthCampaign', 'GrowthCampaign_status_check', '"status" IN (''DRAFT'',''PENDING_APPROVAL'',''SCHEDULED'',''ACTIVE'',''PAUSED'',''COMPLETED'',''ARCHIVED'')'),
    ('GrowthCampaign', 'GrowthCampaign_key_check', '"key" ~ ''^[a-z0-9][a-z0-9-]{1,47}$'''),
    ('GrowthCampaign', 'GrowthCampaign_utm_check', '"utmCampaign" ~ ''^[a-z0-9][a-z0-9_-]{1,63}$'''),
    ('GrowthCampaign', 'GrowthCampaign_budget_check', '"budgetTotalMinor" > 0 AND "budgetDailyMinor" > 0 AND "budgetDailyMinor" <= "budgetTotalMinor"'),
    ('GrowthCampaign', 'GrowthCampaign_currency_check', '"currency" ~ ''^[A-Z]{3}$'''),
    ('GrowthCampaign', 'GrowthCampaign_window_check', '"startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"'),
    ('GrowthCampaign', 'GrowthCampaign_version_check', '"version" >= 1'),
    ('GrowthCampaign', 'GrowthCampaign_pause_reason_check', '"pauseReason" IS NULL OR "pauseReason" IN (''BUDGET'',''MANUAL'',''GUARDRAIL'')'),
    ('GrowthCampaignCreative', 'GrowthCampaignCreative_kind_check', '"kind" IN (''IMAGE'',''VIDEO'',''COPY'',''LANDING'',''LINK'')'),
    ('GrowthCampaignCreative', 'GrowthCampaignCreative_status_check', '"status" IN (''DRAFT'',''APPROVED'',''RETIRED'')'),
    ('GrowthCampaignApproval', 'GrowthCampaignApproval_kind_check', '"kind" IN (''ACTIVATE'',''BUDGET_INCREASE'',''REACTIVATE'')'),
    ('GrowthCampaignApproval', 'GrowthCampaignApproval_decision_check', '"decision" IS NULL OR "decision" IN (''APPROVED'',''REJECTED'')'),
    ('GrowthCampaignApproval', 'GrowthCampaignApproval_maker_checker_check', '"decidedBy" IS NULL OR "decidedBy" <> "requestedBy"'),
    ('GrowthCampaignApproval', 'GrowthCampaignApproval_decided_together_check', '("decision" IS NULL) = ("decidedBy" IS NULL) AND ("decision" IS NULL) = ("decidedAt" IS NULL)'),
    ('GrowthCampaignStatusHistory', 'GrowthCampaignStatusHistory_states_check', '"from" IN (''DRAFT'',''PENDING_APPROVAL'',''SCHEDULED'',''ACTIVE'',''PAUSED'',''COMPLETED'',''ARCHIVED'') AND "to" IN (''DRAFT'',''PENDING_APPROVAL'',''SCHEDULED'',''ACTIVE'',''PAUSED'',''COMPLETED'',''ARCHIVED'') AND "from" <> "to"'),
    ('GrowthCampaignBudgetDaily', 'GrowthCampaignBudgetDaily_nonneg_check', '"plannedMinor" >= 0 AND "approvedSpendMinor" >= 0 AND "pendingSpendMinor" >= 0 AND "utilisationBp" >= 0'),
    ('GrowthSpendEntry', 'GrowthSpendEntry_source_check', '"source" IN (''MANUAL'',''ADAPTER'',''CAMPAIGN_PLAN'')')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- Spend that comes from an adapter is de-duplicated by (campaignId, day, source, adapterRef): re-running a pull can never double a day.
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthSpendEntry_adapter_dedupe_idx" ON "GrowthSpendEntry" ("campaignId", "day", "source", "adapterRef") WHERE "adapterRef" IS NOT NULL AND "campaignId" IS NOT NULL;

-- Append-only tables of Phase 2 share two guard functions. growth_p2_append_only: no bypass. growth_p2_append_only_maint: erasure and retention may UPDATE or DELETE inside the SECURITY DEFINER maintenance functions (kx.growth_maintenance = on).
CREATE OR REPLACE FUNCTION growth_p2_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION growth_p2_append_only_maint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('kx.growth_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed (use growth_erase_subject or growth_purge_expired_v2)', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS growth_campaign_status_history_immutable ON "GrowthCampaignStatusHistory";
CREATE TRIGGER growth_campaign_status_history_immutable BEFORE UPDATE OR DELETE ON "GrowthCampaignStatusHistory" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();
