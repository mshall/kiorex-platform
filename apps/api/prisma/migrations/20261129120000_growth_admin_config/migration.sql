-- GRW-P1-K Super Admin growth configuration. Additive and idempotent.

-- 1. Maker-checker in the database (the API enforces it too; a direct SQL edit must not be able to bypass it).
--    An approved/active/closed version must carry an approver, except the materialised code defaults (ticket = PROPOSED_DEFAULT). NOT VALID: new and changed rows are
--    checked, rows written before this migration are not re-scanned.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthConfigVersion_approver_required_check') THEN
    ALTER TABLE "GrowthConfigVersion" ADD CONSTRAINT "GrowthConfigVersion_approver_required_check"
      CHECK ("status" NOT IN ('APPROVED','ACTIVE','SUPERSEDED','ROLLED_BACK') OR "approvedBy" IS NOT NULL OR "ticket" = 'PROPOSED_DEFAULT') NOT VALID;
  END IF;
END $$;

-- 2. Rows are immutable once they leave DRAFT: the payload, the identity (kind, scope, version), the author and the checksum can never change, the approver can only be
--    set by the PENDING_APPROVAL -> APPROVED step, and only a DRAFT row can be deleted.
CREATE OR REPLACE FUNCTION growth_config_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'GrowthConfigVersion is immutable once submitted: DELETE is not allowed' USING ERRCODE = '55000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."kind" <> OLD."kind" OR NEW."scope" <> OLD."scope" OR NEW."scopeId" <> OLD."scopeId" OR NEW."version" <> OLD."version"
       OR NEW."createdBy" <> OLD."createdBy" OR NEW."checksum" <> OLD."checksum" OR NEW."createdAt" <> OLD."createdAt" OR NEW."supersedesId" IS DISTINCT FROM OLD."supersedesId" THEN
      RAISE EXCEPTION 'GrowthConfigVersion is immutable once submitted: payload and identity cannot change (create a new version)' USING ERRCODE = '55000';
    END IF;
    IF NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy" AND OLD."status" <> 'PENDING_APPROVAL' THEN
      RAISE EXCEPTION 'GrowthConfigVersion approver can only be recorded by the approval step' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS growth_config_version_immutable ON "GrowthConfigVersion";
CREATE TRIGGER growth_config_version_immutable BEFORE UPDATE OR DELETE ON "GrowthConfigVersion" FOR EACH ROW EXECUTE FUNCTION growth_config_version_guard();

-- 3. Propagation monitoring: which reader (an API or site instance, a service inside it) loaded which version of a config. One row per (instance, reader, kind, scope).
CREATE TABLE IF NOT EXISTS "GrowthConfigReader" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "reader" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "scopeId" TEXT NOT NULL DEFAULT '',
    "versionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "firstLoadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthConfigReader_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthConfigReader_instance_reader_key" ON "GrowthConfigReader"("instanceId", "reader", "kind", "scope", "scopeId");
CREATE INDEX IF NOT EXISTS "GrowthConfigReader_kind_scope_idx" ON "GrowthConfigReader"("kind", "scope", "scopeId");

-- 4. Fraud review queue: a human decision on a signal (signals themselves stay evidence and never change an attribution decision).
ALTER TABLE "GrowthFraudSignal" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
CREATE INDEX IF NOT EXISTS "GrowthFraudSignal_reviewStatus_createdAt_idx" ON "GrowthFraudSignal"("reviewStatus", "createdAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthFraudSignal_review_check') THEN
    ALTER TABLE "GrowthFraudSignal" ADD CONSTRAINT "GrowthFraudSignal_review_check"
      CHECK ("reviewStatus" IN ('OPEN','CONFIRMED','DISMISSED') AND ("reviewStatus" = 'OPEN' OR ("reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL)));
  END IF;
END $$;
