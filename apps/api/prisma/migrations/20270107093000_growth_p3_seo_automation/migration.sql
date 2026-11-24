-- GRW-P3-F (wave 7 lane A3): advanced SEO automation: page quality reports, internal link graph, web vitals and indexation snapshots. Schema owned by the W7 owner (lane A1).
-- Additive and idempotent. Page keys are public page identities (slug keys), never a person; vitals are p75 aggregates with a sample size.

CREATE TABLE IF NOT EXISTS "SeoQualityReport" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "pageKey" TEXT NOT NULL,
    "templateKind" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "failedChecks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    CONSTRAINT "SeoQualityReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeoQualityReport_page_hash_key" ON "SeoQualityReport"("market", "pageKey", "locale", "contentHash");
CREATE INDEX IF NOT EXISTS "SeoQualityReport_templateKind_score_idx" ON "SeoQualityReport"("templateKind", "score");

CREATE TABLE IF NOT EXISTS "SeoInternalLink" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "fromKey" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "anchorKind" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeoInternalLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeoInternalLink_edge_key" ON "SeoInternalLink"("market", "fromKey", "toKey", "anchorKind");
CREATE INDEX IF NOT EXISTS "SeoInternalLink_fromKey_rank_idx" ON "SeoInternalLink"("fromKey", "rank");

CREATE TABLE IF NOT EXISTS "SeoVitalSnapshot" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "templateKind" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SeoVitalSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeoVitalSnapshot_key" ON "SeoVitalSnapshot"("market", "templateKind", "metric", "source", "day");

CREATE TABLE IF NOT EXISTS "SeoIndexationSnapshot" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "templateKind" TEXT NOT NULL,
    "submitted" INTEGER NOT NULL DEFAULT 0,
    "indexed" INTEGER NOT NULL DEFAULT 0,
    "excluded" INTEGER NOT NULL DEFAULT 0,
    "reasonBuckets" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "SeoIndexationSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeoIndexationSnapshot_key" ON "SeoIndexationSnapshot"("market", "day", "templateKind");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('SeoQualityReport', 'SeoQualityReport_score_check', '"score" BETWEEN 0 AND 100'),
    ('SeoQualityReport', 'SeoQualityReport_locale_check', '"locale" IN (''ar'',''en'')'),
    ('SeoInternalLink', 'SeoInternalLink_no_self_check', '"fromKey" <> "toKey"'),
    ('SeoVitalSnapshot', 'SeoVitalSnapshot_source_check', '"source" IN (''LAB'',''FIELD'')'),
    ('SeoVitalSnapshot', 'SeoVitalSnapshot_values_check', '"p75" >= 0 AND "sampleSize" >= 0'),
    ('SeoIndexationSnapshot', 'SeoIndexationSnapshot_counts_check', '"submitted" >= 0 AND "indexed" >= 0 AND "excluded" >= 0 AND "indexed" <= "submitted"')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
