-- Kiorly site join requests (leads module). Additive only: three new tables, no change to an existing table.
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "mode" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "contactNameEnc" TEXT NOT NULL,
    "contactRole" TEXT,
    "phoneEnc" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "emailEnc" TEXT,
    "emailHash" TEXT,
    "country" TEXT NOT NULL DEFAULT 'EG',
    "governorate" TEXT,
    "city" TEXT,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "branches" INTEGER,
    "staffCount" INTEGER,
    "specialties" TEXT[],
    "services" TEXT,
    "currentSoftware" TEXT,
    "licencesEnc" TEXT,
    "modules" TEXT[],
    "goLive" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "contactChannel" TEXT,
    "contactTime" TEXT,
    "noteEnc" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "consentTextVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "sourceEnv" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "ownerSub" TEXT,
    "ownerName" TEXT,
    "lostReason" TEXT,
    "tags" TEXT[],
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorName" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "Lead_ref_key" ON "Lead"("ref");
CREATE UNIQUE INDEX "Lead_idempotencyKey_key" ON "Lead"("idempotencyKey");
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
CREATE INDEX "Lead_providerType_idx" ON "Lead"("providerType");
CREATE INDEX "Lead_market_idx" ON "Lead"("market");
CREATE INDEX "Lead_mode_idx" ON "Lead"("mode");
CREATE INDEX "Lead_ownerSub_idx" ON "Lead"("ownerSub");
CREATE INDEX "Lead_phoneHash_idx" ON "Lead"("phoneHash");
CREATE INDEX "Lead_emailHash_idx" ON "Lead"("emailHash");
CREATE INDEX "Lead_isTest_idx" ON "Lead"("isTest");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
CREATE INDEX "LeadEvent_leadId_createdAt_idx" ON "LeadEvent"("leadId", "createdAt");

ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
