-- AlterTable
ALTER TABLE "PartnerConnection" ADD COLUMN "intakeKeyHash" TEXT;

-- CreateTable
CREATE TABLE "PartnerEnrolment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orgRef" TEXT,
    "label" TEXT NOT NULL,
    "signingKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "connectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerIntakeNonce" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerIntakeNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerEnrolment_status_expiresAt_idx" ON "PartnerEnrolment"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PartnerIntakeNonce_seenAt_idx" ON "PartnerIntakeNonce"("seenAt");
