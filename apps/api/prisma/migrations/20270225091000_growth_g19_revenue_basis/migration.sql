-- G-19: record WHERE a revenue confirmation came from. Additive column; existing rows are classified once.
ALTER TABLE "GrowthRevenueFact" ADD COLUMN IF NOT EXISTS "basis" TEXT NOT NULL DEFAULT 'CLINIC_FACT';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthRevenueFact_basis_check') THEN ALTER TABLE "GrowthRevenueFact" ADD CONSTRAINT "GrowthRevenueFact_basis_check" CHECK ("basis" IN ('CLINIC_FACT','INFERRED_AT_COMPLETION')); END IF; END $$;
-- a CONFIRMED row that was written after a PENDING row of the same charge and has no BILLED sibling was produced by the completion inference (the Clinic emits no confirmation event)
UPDATE "GrowthRevenueFact" c SET "basis" = 'INFERRED_AT_COMPLETION'
  WHERE c."kind" = 'CHARGE' AND c."status" = 'CONFIRMED'
    AND EXISTS (SELECT 1 FROM "GrowthRevenueFact" p WHERE p."chargeId" = c."chargeId" AND p."kind" = 'CHARGE' AND p."status" = 'PENDING')
    AND NOT EXISTS (SELECT 1 FROM "GrowthRevenueFact" b WHERE b."chargeId" = c."chargeId" AND b."kind" = 'CHARGE' AND b."status" = 'BILLED');
