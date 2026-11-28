-- Kiorly plan price proposals (maker-checker). Additive: one new table. No price is created by this migration.
CREATE TABLE "KiorlyPlanPriceProposal" (
    "id" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "planRef" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "marketRef" TEXT,
    "interval" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PER_TENANT',
    "currency" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "includedClinicians" INTEGER,
    "extraClinicianAmount" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "requestedFrom" TIMESTAMP(3),
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "warnings" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "proposedByEmail" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "publishedVersion" INTEGER,
    "publishedValidFrom" TIMESTAMP(3),
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "KiorlyPlanPriceProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KiorlyPlanPriceProposal_product_chk" CHECK ("product" IN ('CLINIC', 'PHARMACY', 'LAB')),
    CONSTRAINT "KiorlyPlanPriceProposal_status_chk" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT "KiorlyPlanPriceProposal_interval_chk" CHECK ("interval" IN ('MONTHLY', 'ANNUAL')),
    CONSTRAINT "KiorlyPlanPriceProposal_amount_chk" CHECK ("amount" ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'),
    -- maker-checker: the person who approves or rejects is never the proposer (a withdrawal is the proposer's own act)
    CONSTRAINT "KiorlyPlanPriceProposal_two_person" CHECK ("decidedBy" IS NULL OR "status" = 'WITHDRAWN' OR "decidedBy" <> "proposedBy"),
    CONSTRAINT "KiorlyPlanPriceProposal_withdraw_chk" CHECK ("status" <> 'WITHDRAWN' OR "decidedBy" = "proposedBy"),
    CONSTRAINT "KiorlyPlanPriceProposal_decided_chk" CHECK (("status" = 'PENDING') = ("decidedBy" IS NULL))
);
CREATE INDEX "KiorlyPlanPriceProposal_product_status_idx" ON "KiorlyPlanPriceProposal"("product", "status");
CREATE INDEX "KiorlyPlanPriceProposal_planRef_marketCode_interval_status_idx" ON "KiorlyPlanPriceProposal"("planRef", "marketCode", "interval", "status");
-- one open proposal per plan, market, period and unit (withdraw or decide it first)
CREATE UNIQUE INDEX "KiorlyPlanPriceProposal_one_pending" ON "KiorlyPlanPriceProposal"("product", "planRef", "marketCode", "interval", "unit") WHERE "status" = 'PENDING';

-- append-only history: never deleted; only a PENDING row may change, and only its decision, the publish bookkeeping and the start moved to the approval time
CREATE OR REPLACE FUNCTION kiorly_plan_price_proposal_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'KiorlyPlanPriceProposal is append-only'; END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'KiorlyPlanPriceProposal is append-only: a decided row never changes'; END IF;
  IF NEW.product <> OLD.product OR NEW."planRef" <> OLD."planRef" OR NEW."planKey" <> OLD."planKey" OR NEW."marketCode" <> OLD."marketCode" OR NEW.interval <> OLD.interval OR NEW.unit <> OLD.unit
     OR NEW.currency <> OLD.currency OR NEW.amount <> OLD.amount OR NEW."includedClinicians" IS DISTINCT FROM OLD."includedClinicians" OR NEW."extraClinicianAmount" IS DISTINCT FROM OLD."extraClinicianAmount"
     OR NEW."proposedBy" <> OLD."proposedBy" OR NEW."proposedAt" <> OLD."proposedAt" OR NEW.warnings::text <> OLD.warnings::text OR NEW.preview::text <> OLD.preview::text OR NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'KiorlyPlanPriceProposal: only the decision of a pending row may change';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS kiorly_plan_price_proposal_guard ON "KiorlyPlanPriceProposal";
CREATE TRIGGER kiorly_plan_price_proposal_guard BEFORE UPDATE OR DELETE ON "KiorlyPlanPriceProposal" FOR EACH ROW EXECUTE FUNCTION kiorly_plan_price_proposal_guard();
