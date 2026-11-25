-- COM-1: commission collection and transparency. Additive and idempotent. Kiorly never holds funds: this is the claim / collection / settlement ledger of what Kiorex is owed.
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "commissionDeductedMinor" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "CommissionClaim" (
    "id" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "clinicId" TEXT,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sourceKind" TEXT NOT NULL DEFAULT 'CLINIC_CHARGE',
    "chargeId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "decisionRef" TEXT,
    "policyVersion" TEXT,
    "origin" TEXT NOT NULL DEFAULT '',
    "amountMinor" INTEGER NOT NULL,
    "decisionAmountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "feeBasisMinor" INTEGER,
    "sponsoredDiscountMinor" INTEGER,
    "basisPolicyVersion" TEXT,
    "chargeStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "attendedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "disputeDeadline" TIMESTAMP(3),
    "disputeStatus" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "collectionStatus" TEXT NOT NULL DEFAULT 'UNCOLLECTED',
    "runId" TEXT,
    "collectedMinor" INTEGER NOT NULL DEFAULT 0,
    "reversedAfterCollection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionClaim_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommissionClaim_amount_nonneg" CHECK ("amountMinor" >= 0 AND "collectedMinor" >= 0 AND "collectedMinor" <= "amountMinor")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionClaim_chargeId_key" ON "CommissionClaim"("chargeId");
CREATE INDEX IF NOT EXISTS "CommissionClaim_orgRef_collectionStatus_chargeStatus_idx" ON "CommissionClaim"("orgRef", "collectionStatus", "chargeStatus");
CREATE INDEX IF NOT EXISTS "CommissionClaim_runId_idx" ON "CommissionClaim"("runId");
CREATE INDEX IF NOT EXISTS "CommissionClaim_market_createdAt_idx" ON "CommissionClaim"("market", "createdAt");

CREATE TABLE IF NOT EXISTS "CommissionPolicy" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeRef" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "settings" JSONB NOT NULL,
    "note" TEXT,
    "proposedBy" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    CONSTRAINT "CommissionPolicy_pkey" PRIMARY KEY ("id"),
    -- maker-checker enforced by the database as well: the decider is never the proposer
    CONSTRAINT "CommissionPolicy_two_person" CHECK ("decidedBy" IS NULL OR "decidedBy" <> "proposedBy")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionPolicy_scope_scopeRef_version_key" ON "CommissionPolicy"("scope", "scopeRef", "version");
CREATE INDEX IF NOT EXISTS "CommissionPolicy_scope_scopeRef_status_idx" ON "CommissionPolicy"("scope", "scopeRef", "status");

CREATE TABLE IF NOT EXISTS "CommissionOrgProvider" (
    "orgRef" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "provider" TEXT NOT NULL,
    "chosenBy" TEXT NOT NULL,
    "chosenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionOrgProvider_pkey" PRIMARY KEY ("orgRef")
);

CREATE TABLE IF NOT EXISTS "CommissionSavedMethod" (
    "id" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tokenRef" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "CommissionSavedMethod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommissionSavedMethod_orgRef_status_idx" ON "CommissionSavedMethod"("orgRef", "status");

CREATE TABLE IF NOT EXISTS "CommissionRun" (
    "id" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "periodKey" TEXT NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "collectAt" TIMESTAMP(3) NOT NULL,
    "modeRequested" TEXT,
    "mode" TEXT NOT NULL,
    "fallbackReason" TEXT,
    "provider" TEXT,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "claimsCount" INTEGER NOT NULL DEFAULT 0,
    "claimsMinor" INTEGER NOT NULL DEFAULT 0,
    "collectedMinor" INTEGER NOT NULL DEFAULT 0,
    "deductedMinor" INTEGER NOT NULL DEFAULT 0,
    "invoicedMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "settingsJson" JSONB NOT NULL,
    "invoiceNo" TEXT,
    "invoiceDueAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionRun_pkey" PRIMARY KEY ("id"),
    -- the books of a run can never over-collect
    CONSTRAINT "CommissionRun_bounds" CHECK ("collectedMinor" >= 0 AND "deductedMinor" >= 0 AND "invoicedMinor" >= 0 AND "paidMinor" >= 0 AND "collectedMinor" + "deductedMinor" + "invoicedMinor" <= "claimsMinor")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionRun_idempotencyKey_key" ON "CommissionRun"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionRun_orgRef_periodKey_key" ON "CommissionRun"("orgRef", "periodKey");
CREATE INDEX IF NOT EXISTS "CommissionRun_status_collectAt_idx" ON "CommissionRun"("status", "collectAt");
CREATE INDEX IF NOT EXISTS "CommissionRun_market_createdAt_idx" ON "CommissionRun"("market", "createdAt");

CREATE TABLE IF NOT EXISTS "CommissionAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT,
    "providerRef" TEXT,
    "payoutRef" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionAttempt_idempotencyKey_key" ON "CommissionAttempt"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CommissionAttempt_runId_attemptNo_idx" ON "CommissionAttempt"("runId", "attemptNo");
CREATE INDEX IF NOT EXISTS "CommissionAttempt_status_scheduledFor_idx" ON "CommissionAttempt"("status", "scheduledFor");

CREATE TABLE IF NOT EXISTS "CommissionTimeline" (
    "id" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionTimeline_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommissionTimeline_subjectType_subjectId_at_idx" ON "CommissionTimeline"("subjectType", "subjectId", "at");
CREATE INDEX IF NOT EXISTS "CommissionTimeline_orgRef_at_idx" ON "CommissionTimeline"("orgRef", "at");
-- append-only: no update, no delete
CREATE OR REPLACE FUNCTION commission_timeline_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'CommissionTimeline is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS commission_timeline_no_update ON "CommissionTimeline";
CREATE TRIGGER commission_timeline_no_update BEFORE UPDATE OR DELETE ON "CommissionTimeline" FOR EACH ROW EXECUTE FUNCTION commission_timeline_immutable();

CREATE TABLE IF NOT EXISTS "CommissionExportAudit" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "scopeOrg" TEXT,
    "filter" JSONB,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionExportAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommissionExportAudit_actor_createdAt_idx" ON "CommissionExportAudit"("actor", "createdAt");
