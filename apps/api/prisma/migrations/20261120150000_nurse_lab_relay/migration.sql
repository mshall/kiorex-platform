-- CreateTable
CREATE TABLE "NurseLabRelay" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientRef" TEXT NOT NULL,
    "partnerOrderId" TEXT,
    "labOrderNumber" TEXT,
    "status" TEXT NOT NULL,
    "lastLabStatus" TEXT,
    "refusalCode" TEXT,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NurseLabRelay_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "NurseLabRelay_partnerOrderId_idx" ON "NurseLabRelay"("partnerOrderId");
-- CreateIndex
CREATE INDEX "NurseLabRelay_clinicId_idx" ON "NurseLabRelay"("clinicId");
