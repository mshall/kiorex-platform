-- COM-2: commission rates per organisation type (default) and per organisation (override). Additive and idempotent. No numeric rate is shipped: an unset default means no charge.
CREATE TABLE IF NOT EXISTS "CommissionRatePolicy" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "scopeRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RATE',
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "spec" JSONB,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "requestedFrom" TIMESTAMP(3),
    "reason" TEXT,
    "proposedBy" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    CONSTRAINT "CommissionRatePolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommissionRatePolicy_two_person" CHECK ("decidedBy" IS NULL OR "decidedBy" <> "proposedBy"),
    CONSTRAINT "CommissionRatePolicy_scope_chk" CHECK ("scope" IN ('DEFAULT', 'ORG')),
    CONSTRAINT "CommissionRatePolicy_product_chk" CHECK ("product" IN ('CLINIC', 'PHARMACY', 'LAB')),
    CONSTRAINT "CommissionRatePolicy_kind_chk" CHECK (("kind" = 'RATE' AND "spec" IS NOT NULL) OR ("kind" = 'INHERIT' AND "scope" = 'ORG' AND "spec" IS NULL)),
    CONSTRAINT "CommissionRatePolicy_org_reason_chk" CHECK ("scope" <> 'ORG' OR length(btrim(coalesce("reason", ''))) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionRatePolicy_scope_scopeRef_version_key" ON "CommissionRatePolicy"("scope", "scopeRef", "version");
CREATE INDEX IF NOT EXISTS "CommissionRatePolicy_scope_scopeRef_status_effectiveFrom_idx" ON "CommissionRatePolicy"("scope", "scopeRef", "status", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "CommissionRatePolicy_product_status_idx" ON "CommissionRatePolicy"("product", "status");

CREATE TABLE IF NOT EXISTS "CommissionOrgRateLink" (
    "orgRef" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "defaultPolicyId" TEXT,
    "defaultVersion" INTEGER,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPushedAt" TIMESTAMP(3),
    "lastPushedVersion" TEXT,
    CONSTRAINT "CommissionOrgRateLink_pkey" PRIMARY KEY ("orgRef"),
    CONSTRAINT "CommissionOrgRateLink_product_chk" CHECK ("product" IN ('CLINIC', 'PHARMACY', 'LAB'))
);
CREATE INDEX IF NOT EXISTS "CommissionOrgRateLink_product_idx" ON "CommissionOrgRateLink"("product");

ALTER TABLE "CommissionClaim" ADD COLUMN IF NOT EXISTS "rateSource" TEXT;
ALTER TABLE "CommissionClaim" ADD COLUMN IF NOT EXISTS "ratePolicyId" TEXT;
ALTER TABLE "CommissionClaim" ADD COLUMN IF NOT EXISTS "rateSnapshot" JSONB;
-- Pharmacy orders and lab bookings keep the rate that applied at creation (the fee at release is computed from it; null = legacy take rate)
ALTER TABLE "PharmacyOrder" ADD COLUMN IF NOT EXISTS "rateSnapshot" JSONB;
ALTER TABLE "LabBooking" ADD COLUMN IF NOT EXISTS "rateSnapshot" JSONB;

-- append-only history: a rate row is never deleted; only a PENDING row may be decided (status, decision fields, and the start moved to the approval time); nothing else ever changes
CREATE OR REPLACE FUNCTION commission_rate_policy_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CommissionRatePolicy is append-only'; END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'CommissionRatePolicy is append-only: a decided row never changes'; END IF;
  IF NEW.scope <> OLD.scope OR NEW.product <> OLD.product OR NEW."scopeRef" <> OLD."scopeRef" OR NEW.kind <> OLD.kind OR NEW.version <> OLD.version
     OR NEW.spec IS DISTINCT FROM OLD.spec OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW."proposedBy" <> OLD."proposedBy" THEN
    RAISE EXCEPTION 'CommissionRatePolicy: only the decision of a pending row may change';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS commission_rate_policy_guard ON "CommissionRatePolicy";
CREATE TRIGGER commission_rate_policy_guard BEFORE UPDATE OR DELETE ON "CommissionRatePolicy" FOR EACH ROW EXECUTE FUNCTION commission_rate_policy_guard();
