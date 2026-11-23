-- CreateTable
CREATE TABLE "PartnerConnection" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "contactEmail" TEXT,
    "baseUrl" TEXT,
    "clientKey" TEXT,
    "secretsEnc" TEXT,
    "pendingSecretsEnc" TEXT,
    "statusTokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "readiness" JSONB NOT NULL DEFAULT '{}',
    "checks" JSONB NOT NULL DEFAULT '{}',
    "human" JSONB NOT NULL DEFAULT '{}',
    "registrationId" TEXT,
    "decisionReason" TEXT,
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "checksRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerConnection_status_idx" ON "PartnerConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerConnection_kind_orgRef_key" ON "PartnerConnection"("kind", "orgRef");
