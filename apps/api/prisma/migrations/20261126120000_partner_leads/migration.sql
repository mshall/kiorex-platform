-- ADR-040 front door: partner leads (Talk to us) and privacy-safe funnel markers.
CREATE TABLE "PartnerLead" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "preferredTime" TEXT,
    "note" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "market" TEXT NOT NULL DEFAULT 'EG',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assignee" TEXT,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerLead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartnerLead_kind_orgRef_key" ON "PartnerLead"("kind", "orgRef");
CREATE INDEX "PartnerLead_status_createdAt_idx" ON "PartnerLead"("status", "createdAt");

CREATE TABLE "PartnerFunnelMark" (
    "kind" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerFunnelMark_pkey" PRIMARY KEY ("kind","orgRef","stage")
);
CREATE INDEX "PartnerFunnelMark_stage_firstAt_idx" ON "PartnerFunnelMark"("stage", "firstAt");
