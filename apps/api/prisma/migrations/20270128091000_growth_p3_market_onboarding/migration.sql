-- GRW-P3-G (market onboarding wizard, wave 8 lane A2). Additive and idempotent. Reserved slot of the plan (section 4.3): KP W8 `...091000_growth_p3_market_onboarding`.
-- Reference data only: no person identifier, no secret, no legal text. The plan never makes a market live (market.<cc>.live stays the human gate, ADR-024).

CREATE TABLE IF NOT EXISTS "MarketOnboardingPlan" (
    "id" TEXT NOT NULL,
    "cc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "steps" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "MarketOnboardingPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketOnboardingPlan_cc_key" ON "MarketOnboardingPlan"("cc");

CREATE TABLE IF NOT EXISTS "MarketGeography" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentKey" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "slugAr" TEXT NOT NULL,
    "slugEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketGeography_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketGeography_market_level_key_key" ON "MarketGeography"("market", "level", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketGeography_slugAr_key" ON "MarketGeography"("market", "level", "slugAr");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketGeography_slugEn_key" ON "MarketGeography"("market", "level", "slugEn");
CREATE INDEX IF NOT EXISTS "MarketGeography_market_level_parentKey_idx" ON "MarketGeography"("market", "level", "parentKey");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('MarketOnboardingPlan', 'MarketOnboardingPlan_cc_check', '"cc" ~ ''^[A-Z]{2}$'''),
    ('MarketOnboardingPlan', 'MarketOnboardingPlan_status_check', '"status" IN (''DRAFT'',''READY'',''PUBLISHED'',''CANCELLED'')'),
    ('MarketOnboardingPlan', 'MarketOnboardingPlan_ready_check', '"status" <> ''READY'' OR "readyAt" IS NOT NULL'),
    ('MarketOnboardingPlan', 'MarketOnboardingPlan_published_check', '"status" <> ''PUBLISHED'' OR "publishedAt" IS NOT NULL'),
    ('MarketGeography', 'MarketGeography_market_check', '"market" ~ ''^[A-Z]{2}$'''),
    ('MarketGeography', 'MarketGeography_level_check', '"level" IN (''CITY'',''DISTRICT'')'),
    ('MarketGeography', 'MarketGeography_key_check', '"key" ~ ''^[a-z0-9][a-z0-9_-]{0,63}$'''),
    ('MarketGeography', 'MarketGeography_slug_check', '"slugAr" ~ ''^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'' AND "slugEn" ~ ''^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$''')
  ) AS t(tbl, name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
