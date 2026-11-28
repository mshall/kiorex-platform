-- Join request becomes WON: exactly one DRAFT onboarding request per lead (additive: one new table, nothing existing changes).
CREATE TABLE "LeadOnboardingRequest" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "kind" TEXT,
    "legalName" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "modules" TEXT[],
    "market" TEXT NOT NULL,
    "contactRef" TEXT NOT NULL,
    "assigneeSub" TEXT,
    "assigneeName" TEXT,
    "note" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadOnboardingRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadOnboardingRequest_status_check" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELLED')),
    CONSTRAINT "LeadOnboardingRequest_two_person_check" CHECK ("status" <> 'APPROVED' OR "decidedBy" IS DISTINCT FROM "submittedBy")
);

CREATE UNIQUE INDEX "LeadOnboardingRequest_leadId_key" ON "LeadOnboardingRequest"("leadId");
CREATE INDEX "LeadOnboardingRequest_status_createdAt_idx" ON "LeadOnboardingRequest"("status", "createdAt");
CREATE INDEX "LeadOnboardingRequest_assigneeSub_idx" ON "LeadOnboardingRequest"("assigneeSub");

ALTER TABLE "LeadOnboardingRequest" ADD CONSTRAINT "LeadOnboardingRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
