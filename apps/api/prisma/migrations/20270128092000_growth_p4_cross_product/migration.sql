-- GRW-P4-A (wave 8 lane A3): cross-product journeys. Slot reserved in the plan for the W8 schema owner (lane A4); written here by lane A3 so the package runs end to end.
-- If lane A4 ships the same name the two files must be merged into one (the statements are idempotent).
--
-- CrossProductContinuity: append-only measurement link between a clinic booking (the parent) and a downstream fact (pharmacy order, lab booking, care-plan booking)
-- that was created through a Kiorex continuity entry point. It holds ONLY product names, keyed hashes of the two fact ids, the two decision ids, the two origins,
-- the hours between the visit and the downstream fact, and timestamps. No person, no clinic, no specialty, no item, no test name, no diagnosis.
-- CrossProductEntryPoint: the patient's OWN in-app prompt state (which card may be shown, until when). Per person, short lived (expiresAt, hard purge after 60 days),
-- erased with the subject; it holds a kind, a keyed hash of the clinical fact id and the parent booking id, never content. It is never read by an aggregate that groups by person.

CREATE TABLE IF NOT EXISTS "CrossProductContinuity" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "fromProduct" TEXT NOT NULL DEFAULT 'CLINIC',
    "toProduct" TEXT NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "fromFactRef" TEXT NOT NULL,
    "toFactRef" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "parentDecisionId" TEXT,
    "parentOrigin" TEXT,
    "toOrigin" TEXT NOT NULL,
    "lagHours" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrossProductContinuity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrossProductContinuity_to_key" ON "CrossProductContinuity"("toProduct", "toFactRef");
CREATE INDEX IF NOT EXISTS "CrossProductContinuity_market_to_createdAt_idx" ON "CrossProductContinuity"("market", "toProduct", "createdAt");

CREATE TABLE IF NOT EXISTS "CrossProductEntryPoint" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "factRef" TEXT NOT NULL,
    "parentBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    CONSTRAINT "CrossProductEntryPoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrossProductEntryPoint_sub_kind_fact_key" ON "CrossProductEntryPoint"("sub", "kind", "factRef");
CREATE INDEX IF NOT EXISTS "CrossProductEntryPoint_sub_expires_idx" ON "CrossProductEntryPoint"("sub", "expiresAt");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('CrossProductContinuity', 'CrossProductContinuity_to_product_check', '"toProduct" IN (''PHARMACY'',''LAB'',''NURSE'')'),
    ('CrossProductContinuity', 'CrossProductContinuity_from_product_check', '"fromProduct" = ''CLINIC'''),
    ('CrossProductContinuity', 'CrossProductContinuity_entry_check', '"entryPoint" IN (''RX_TO_PHARMACY'',''LAB_ORDER_TO_LAB'',''CARE_PLAN_TO_HOME_VISIT'')'),
    ('CrossProductContinuity', 'CrossProductContinuity_refs_check', '"fromFactRef" ~ ''^[a-f0-9]{32}$'' AND "toFactRef" ~ ''^[a-f0-9]{32}$'''),
    ('CrossProductContinuity', 'CrossProductContinuity_origin_check', '"toOrigin" IN (''PROVIDER_LED'',''MARKETPLACE'',''UNATTRIBUTED'',''CROSS_PRODUCT'') AND ("parentOrigin" IS NULL OR "parentOrigin" IN (''PROVIDER_LED'',''MARKETPLACE'',''UNATTRIBUTED''))'),
    ('CrossProductContinuity', 'CrossProductContinuity_lag_check', '"lagHours" >= 0'),
    ('CrossProductEntryPoint', 'CrossProductEntryPoint_kind_check', '"kind" IN (''RX_TO_PHARMACY'',''LAB_ORDER_TO_LAB'',''CARE_PLAN_TO_HOME_VISIT'')'),
    ('CrossProductEntryPoint', 'CrossProductEntryPoint_fact_ref_check', '"factRef" ~ ''^[a-f0-9]{32}$''')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS growth_cross_product_continuity_immutable ON "CrossProductContinuity";
CREATE TRIGGER growth_cross_product_continuity_immutable BEFORE UPDATE OR DELETE ON "CrossProductContinuity" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();
