CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'INTERNAL',
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kiorly',
    "type" TEXT NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KvState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KvState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "clientId" TEXT,
    "device" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "nameEn" TEXT,
    "nameAr" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "nationalIdEnc" TEXT,
    "nationalIdHash" TEXT,
    "preferredLocale" TEXT NOT NULL DEFAULT 'ar',
    "market" TEXT NOT NULL DEFAULT 'EG',
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dependant" (
    "id" TEXT NOT NULL,
    "guardianSub" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "relationship" TEXT NOT NULL,
    "evidence" TEXT,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dependant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'TODO_NEEDS_HUMAN_v0',
    "source" TEXT NOT NULL DEFAULT 'app',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "result" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KiorlyPatientLink" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "dependantId" TEXT,
    "clinicId" TEXT NOT NULL,
    "kiorlyPatientId" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LINKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KiorlyPatientLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "clinicId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "nameEn" TEXT,
    "nameAr" TEXT,
    "clinicNameEn" TEXT,
    "clinicNameAr" TEXT,
    "specialty" TEXT,
    "subSpecialties" TEXT[],
    "languages" TEXT[],
    "gender" TEXT,
    "governorate" TEXT,
    "area" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "minFeeMinor" INTEGER,
    "maxFeeMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "acceptsDeposit" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "searchText" TEXT NOT NULL DEFAULT '',
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileViewDaily" (
    "providerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "pushedAt" TIMESTAMP(3),

    CONSTRAINT "ProfileViewDaily_pkey" PRIMARY KEY ("providerId","date")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialtyCode" TEXT,
    "providerId" TEXT,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingIntent" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "dependantId" TEXT,
    "providerId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "tenantId" TEXT,
    "typeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'MARKETPLACE',
    "holdId" TEXT,
    "holdExternalRef" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "callState" TEXT NOT NULL DEFAULT 'NONE',
    "kiorlyAppointmentId" TEXT,
    "kiorlyPatientId" TEXT,
    "kiorlyVersion" INTEGER NOT NULL DEFAULT 0,
    "confirmationDueAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancellationReason" TEXT,
    "depositRefundable" BOOLEAN,
    "failureCode" TEXT,
    "depositStatus" TEXT NOT NULL DEFAULT 'NONE',
    "depositAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "feeMinor" INTEGER,
    "patientSnapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "terminalAt" TIMESTAMP(3),

    CONSTRAINT "BookingIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "payLinkToken" TEXT,
    "sub" TEXT,
    "clinicId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "psp" TEXT NOT NULL,
    "pspRef" TEXT,
    "checkoutUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "releasedAt" TIMESTAMP(3),
    "releaseKind" TEXT,
    "payoutId" TEXT,
    "capturedAt" TIMESTAMP(3),
    "kiorlyNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayLink" (
    "token" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "externalRef" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayLink_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "pspRefundRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTx" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "clinicId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "debitMinor" INTEGER NOT NULL DEFAULT 0,
    "creditMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "payoutRef" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "periodKey" TEXT NOT NULL,
    "paymentRefs" JSONB NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PspSettlementLine" (
    "id" TEXT NOT NULL,
    "psp" TEXT NOT NULL,
    "pspRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "date" DATE NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PspSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "discrepancies" JSONB NOT NULL,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "bookingId" TEXT,
    "channel" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "params" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "sub" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quietStart" INTEGER,
    "quietEnd" INTEGER,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("sub","channel")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "kiorlyAppointmentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "moderationFlags" JSONB,
    "clinicReply" TEXT,
    "editableUntil" TIMESTAMP(3) NOT NULL,
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "bookingId" TEXT,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagDefinition" (
    "key" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "scopes" TEXT[],
    "dependsOn" TEXT[],
    "launchLocked" BOOLEAN NOT NULL DEFAULT false,
    "moneyPath" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "whenOff" TEXT,
    "gateHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "FlagValue" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "ticket" TEXT,
    "setBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagGateEvidence" (
    "flagKey" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "approver" TEXT NOT NULL,
    "approvedOn" TIMESTAMP(3) NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagGateEvidence_pkey" PRIMARY KEY ("flagKey")
);

-- CreateTable
CREATE TABLE "FlagChangeRequest" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "reviewDueAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "FlagChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagAudit" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "ticket" TEXT,
    "expiresAt" TIMESTAMP(3),
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "event" TEXT NOT NULL DEFAULT 'TOGGLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRegistration" (
    "product" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookSecretEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedVersion" INTEGER NOT NULL DEFAULT 0,
    "lastFetchedAt" TIMESTAMP(3),
    "lastPushedVersion" INTEGER NOT NULL DEFAULT 0,
    "lastPushedAt" TIMESTAMP(3),
    "lastPushError" TEXT,

    CONSTRAINT "ProductRegistration_pkey" PRIMARY KEY ("product")
);

-- CreateTable
CREATE TABLE "ControlState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "sub" TEXT,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "redactions" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_sid_key" ON "AuthSession"("sid");

-- CreateIndex
CREATE INDEX "AuthSession_sub_idx" ON "AuthSession"("sub");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_sub_key" ON "PatientProfile"("sub");

-- CreateIndex
CREATE INDEX "PatientProfile_nationalIdHash_idx" ON "PatientProfile"("nationalIdHash");

-- CreateIndex
CREATE INDEX "Dependant_guardianSub_idx" ON "Dependant"("guardianSub");

-- CreateIndex
CREATE INDEX "ConsentRecord_sub_purpose_createdAt_idx" ON "ConsentRecord"("sub", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "DataRequest_sub_idx" ON "DataRequest"("sub");

-- CreateIndex
CREATE INDEX "KiorlyPatientLink_sub_idx" ON "KiorlyPatientLink"("sub");

-- CreateIndex
CREATE UNIQUE INDEX "KiorlyPatientLink_sub_clinicId_kiorlyPatientId_key" ON "KiorlyPatientLink"("sub", "clinicId", "kiorlyPatientId");

-- CreateIndex
CREATE INDEX "Provider_status_specialty_idx" ON "Provider"("status", "specialty");

-- CreateIndex
CREATE INDEX "Provider_clinicId_clinicianId_idx" ON "Provider"("clinicId", "clinicianId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "BookingIntent_sub_status_idx" ON "BookingIntent"("sub", "status");

-- CreateIndex
CREATE INDEX "BookingIntent_status_updatedAt_idx" ON "BookingIntent"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "BookingIntent_kiorlyAppointmentId_idx" ON "BookingIntent"("kiorlyAppointmentId");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_pspRef_key" ON "PaymentIntent"("pspRef");

-- CreateIndex
CREATE INDEX "PaymentIntent_bookingId_idx" ON "PaymentIntent"("bookingId");

-- CreateIndex
CREATE INDEX "PaymentIntent_clinicId_status_idx" ON "PaymentIntent"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTx_idempotencyKey_key" ON "LedgerTx"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_idx" ON "LedgerEntry"("account");

-- CreateIndex
CREATE INDEX "LedgerEntry_txId_idx" ON "LedgerEntry"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_payoutRef_key" ON "Payout"("payoutRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_clinicId_periodKey_key" ON "Payout"("clinicId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "PspSettlementLine_psp_pspRef_kind_key" ON "PspSettlementLine"("psp", "pspRef", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Message_dedupeKey_key" ON "Message"("dedupeKey");

-- CreateIndex
CREATE INDEX "Message_sub_createdAt_idx" ON "Message"("sub", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_scheduledFor_idx" ON "Message"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");

-- CreateIndex
CREATE INDEX "Review_providerId_status_idx" ON "Review"("providerId", "status");

-- CreateIndex
CREATE INDEX "ModerationCase_status_idx" ON "ModerationCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FlagValue_flagKey_scope_scopeId_key" ON "FlagValue"("flagKey", "scope", "scopeId");

-- CreateIndex
CREATE INDEX "FlagAudit_flagKey_createdAt_idx" ON "FlagAudit"("flagKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRegistration_keyId_key" ON "ProductRegistration"("keyId");

-- CreateIndex
CREATE INDEX "AiUsage_sub_createdAt_idx" ON "AiUsage"("sub", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "BookingIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_txId_fkey" FOREIGN KEY ("txId") REFERENCES "LedgerTx"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Search (KXM-DS-01): trigram + simple FTS over denormalised search text
CREATE INDEX "Provider_searchText_trgm" ON "Provider" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "Provider_searchText_fts" ON "Provider" USING GIN (to_tsvector('simple', "searchText"));

-- Ledger integrity: single-sided non-negative entries; every transaction balances at commit
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_one_side" CHECK ("debitMinor" >= 0 AND "creditMinor" >= 0 AND ("debitMinor" = 0 OR "creditMinor" = 0));
CREATE OR REPLACE FUNCTION ledger_tx_balanced() RETURNS trigger AS $$
DECLARE d bigint; c bigint;
BEGIN
  SELECT COALESCE(SUM("debitMinor"),0), COALESCE(SUM("creditMinor"),0) INTO d, c FROM "LedgerEntry" WHERE "txId" = NEW."txId";
  IF d <> c THEN RAISE EXCEPTION 'ledger transaction % unbalanced: debit % credit %', NEW."txId", d, c; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_entry_balanced AFTER INSERT ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_tx_balanced();
