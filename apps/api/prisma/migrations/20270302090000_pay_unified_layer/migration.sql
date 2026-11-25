-- Kiorly Pay unified layer: invoice matching queue, payment links, fraud assessments (shadow), per-organisation provider preference. Idempotent. Holds no money, no card data, no secret.
CREATE TABLE IF NOT EXISTS "PayMatchSignal" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "psp" TEXT NOT NULL,
    "pspRef" TEXT NOT NULL,
    "reference" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payerMasked" TEXT,
    "eventKind" TEXT NOT NULL DEFAULT 'payment.captured',
    "fileId" TEXT,
    "decision" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "targetKind" TEXT,
    "targetId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayMatchSignal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayMatchSignal_amount_pos" CHECK ("amountMinor" > 0),
    CONSTRAINT "PayMatchSignal_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayMatchSignal_dedupeKey_key" ON "PayMatchSignal"("dedupeKey");
CREATE INDEX IF NOT EXISTS "PayMatchSignal_status_decision_createdAt_idx" ON "PayMatchSignal"("status", "decision", "createdAt");
CREATE INDEX IF NOT EXISTS "PayMatchSignal_targetId_idx" ON "PayMatchSignal"("targetId");

CREATE TABLE IF NOT EXISTS "PayLinkIssue" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "rail" TEXT NOT NULL DEFAULT 'card',
    "qrKind" TEXT NOT NULL DEFAULT 'LINK',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "paymentIntentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayLinkIssue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayLinkIssue_amount_pos" CHECK ("amountMinor" > 0)
);
CREATE INDEX IF NOT EXISTS "PayLinkIssue_organisationId_createdAt_idx" ON "PayLinkIssue"("organisationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PayLinkIssue_subjectId_idx" ON "PayLinkIssue"("subjectId");

CREATE TABLE IF NOT EXISTS "PayFraudAssessment" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "organisationId" TEXT,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayFraudAssessment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayFraudAssessment_score_range" CHECK ("score" >= 0 AND "score" <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayFraudAssessment_attemptId_key" ON "PayFraudAssessment"("attemptId");
CREATE INDEX IF NOT EXISTS "PayFraudAssessment_status_band_createdAt_idx" ON "PayFraudAssessment"("status", "band", "createdAt");
CREATE INDEX IF NOT EXISTS "PayFraudAssessment_accountId_idx" ON "PayFraudAssessment"("accountId");

CREATE TABLE IF NOT EXISTS "PayOrgProviderPref" (
    "organisationId" TEXT NOT NULL,
    "order" JSONB NOT NULL,
    "blocked" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayOrgProviderPref_pkey" PRIMARY KEY ("organisationId")
);
