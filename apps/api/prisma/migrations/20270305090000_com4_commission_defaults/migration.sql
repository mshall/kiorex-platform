-- COM-4: provenance of a commission row. NULL = entered by an operator through Ops (maker-checker). 'SEEDED_DEFAULT' = installed by the shipped, versioned recommended defaults (Docs/COMMISSION_DEFAULTS.md).
-- Additive and idempotent. Existing rows keep NULL (operator). The rate history stays append-only: the guard also refuses to change the provenance of a pending row.
ALTER TABLE "CommissionRatePolicy" ADD COLUMN IF NOT EXISTS "provenance" TEXT;
ALTER TABLE "CommissionRatePolicy" ADD COLUMN IF NOT EXISTS "seedVersion" INTEGER;
ALTER TABLE "CommissionPolicy" ADD COLUMN IF NOT EXISTS "provenance" TEXT;
ALTER TABLE "CommissionPolicy" ADD COLUMN IF NOT EXISTS "seedVersion" INTEGER;

CREATE OR REPLACE FUNCTION commission_rate_policy_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CommissionRatePolicy is append-only'; END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'CommissionRatePolicy is append-only: a decided row never changes'; END IF;
  IF NEW.scope <> OLD.scope OR NEW.product <> OLD.product OR NEW."scopeRef" <> OLD."scopeRef" OR NEW.kind <> OLD.kind OR NEW.version <> OLD.version
     OR NEW.spec IS DISTINCT FROM OLD.spec OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW."proposedBy" <> OLD."proposedBy"
     OR NEW.provenance IS DISTINCT FROM OLD.provenance OR NEW."seedVersion" IS DISTINCT FROM OLD."seedVersion" THEN
    RAISE EXCEPTION 'CommissionRatePolicy: only the decision of a pending row may change';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
