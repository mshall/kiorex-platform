-- PAY-READY: payments ready for real sandbox gateways. Idempotent (IF NOT EXISTS) so a partial replay is safe.
-- Corporate benefit columns on the deposit intent, authorization / void, hashed card fingerprint, dispute state, PSP mode,
-- refund failure fields, settlement file import, PaymentDispute, PspSetting. No secret and no card number is ever stored.
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "corporateMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "corporatePostedMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "corporateVoidedMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "authorizedAt" TIMESTAMP(3);
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "cardFingerprint" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "cardBrand" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "cardLast4" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "threeDsStatus" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "disputeState" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "pspMode" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "lastPolledAt" TIMESTAMP(3);
ALTER TABLE "PaymentIntent" DROP CONSTRAINT IF EXISTS "PaymentIntent_corporate_nonneg";
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_corporate_nonneg" CHECK ("corporateMinor" >= 0 AND "corporatePostedMinor" >= 0 AND "corporateVoidedMinor" >= 0 AND "corporateVoidedMinor" <= "corporateMinor" AND "corporatePostedMinor" <= "corporateMinor");
CREATE INDEX IF NOT EXISTS "PaymentIntent_cardFingerprint_idx" ON "PaymentIntent"("cardFingerprint") WHERE "cardFingerprint" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "PaymentIntent_status_createdAt_idx" ON "PaymentIntent"("status", "createdAt");

ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;

ALTER TABLE "PspSettlementLine" ADD COLUMN IF NOT EXISTS "fileId" TEXT;
ALTER TABLE "PspSettlementLine" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE "PspSettlementLine" ADD COLUMN IF NOT EXISTS "payoutRef" TEXT;
CREATE INDEX IF NOT EXISTS "PspSettlementLine_fileId_idx" ON "PspSettlementLine"("fileId");

CREATE TABLE IF NOT EXISTS "PspSettlementFile" (
    "id" TEXT NOT NULL,
    "psp" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PspSettlementFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PspSettlementFile_psp_sha256_key" ON "PspSettlementFile"("psp", "sha256");

CREATE TABLE IF NOT EXISTS "PaymentDispute" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "psp" TEXT NOT NULL,
    "pspDisputeRef" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "reasonCode" TEXT,
    "evidenceDueAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "holds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentDispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentDispute_psp_pspDisputeRef_key" ON "PaymentDispute"("psp", "pspDisputeRef");
CREATE INDEX IF NOT EXISTS "PaymentDispute_paymentId_idx" ON "PaymentDispute"("paymentId");
CREATE INDEX IF NOT EXISTS "PaymentDispute_state_idx" ON "PaymentDispute"("state");
DO $$ BEGIN
  ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PspSetting" (
    "psp" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT '*',
    "settings" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PspSetting_pkey" PRIMARY KEY ("psp", "market")
);
