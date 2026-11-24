-- GRW-P4-B2 (wave 7 lane A4): Kiorex product ingest and decision for Pharmacy, Lab and Nurse. Schema owned by the W7 owner (lane A1).
-- Additive and idempotent. GrowthAcquisitionSource gains `product` (default CLINIC; the existing unique key (market, sourceKind, sourceRef) is NOT widened: see the as-built note, a code collision across products is refused).
-- GrowthProductDecision is append-only, one decision per (factKind, factId, policyVersionId). The commission link of products stays inert (AD-13): origin is recorded, no charge exists.
-- GrowthMetricDaily already has a `product` dimension (migration 20261128100000); GrowthEvent carries the product inside props.

ALTER TABLE "GrowthAcquisitionSource" ADD COLUMN IF NOT EXISTS "product" TEXT NOT NULL DEFAULT 'CLINIC';

CREATE TABLE IF NOT EXISTS "GrowthProductDecision" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "product" TEXT NOT NULL,
    "factKind" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "factStatusRef" TEXT,
    "origin" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "evidenceTouchIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "parentDecisionId" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthProductDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthProductDecision_fact_policy_key" ON "GrowthProductDecision"("factKind", "factId", "policyVersionId");
CREATE INDEX IF NOT EXISTS "GrowthProductDecision_product_origin_createdAt_idx" ON "GrowthProductDecision"("product", "origin", "createdAt");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('GrowthAcquisitionSource', 'GrowthAcquisitionSource_product_check', '"product" IN (''CLINIC'',''PHARMACY'',''LAB'',''NURSE'')'),
    ('GrowthProductDecision', 'GrowthProductDecision_product_check', '"product" IN (''PHARMACY'',''LAB'',''NURSE'',''CLINIC'')'),
    ('GrowthProductDecision', 'GrowthProductDecision_fact_kind_check', '"factKind" IN (''ORDER'',''LAB_BOOKING'',''CARE_PLAN_BOOKING'')'),
    ('GrowthProductDecision', 'GrowthProductDecision_origin_check', '"origin" IN (''PROVIDER_LED'',''MARKETPLACE'',''UNATTRIBUTED'',''CROSS_PRODUCT'')'),
    ('GrowthProductDecision', 'GrowthProductDecision_inputs_hash_check', '"inputsHash" ~ ''^[a-f0-9]{64}$''')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS growth_product_decision_immutable ON "GrowthProductDecision";
CREATE TRIGGER growth_product_decision_immutable BEFORE UPDATE OR DELETE ON "GrowthProductDecision" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();
