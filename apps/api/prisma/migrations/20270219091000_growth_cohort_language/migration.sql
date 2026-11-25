-- Gap closure: cohort cut by language (the patient's preferred language, ar or en). Additive: existing rows keep language '' (not applicable).
ALTER TABLE "GrowthCohortMonthly" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "GrowthCohortMonthly_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthCohortMonthly_lang_key" ON "GrowthCohortMonthly"("market", "cohortMonth", "cohortBasis", "sourceKind", "campaignId", "platform", "language", "monthIndex");
