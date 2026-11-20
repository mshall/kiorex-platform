-- Rev 2.3 home visits (KXMHV01-10), flag gate ids, KXMPAY07 hold-for-review, KXMOP12 safety alerts. Additive; the hand-made pg_trgm index on Provider.searchText is untouched.
-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN     "careType" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "serviceLocation" TEXT;

-- AlterTable
ALTER TABLE "BookingIntent" ADD COLUMN     "abortedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "assignee" JSONB,
ADD COLUMN     "carePlanId" TEXT,
ADD COLUMN     "careType" TEXT NOT NULL DEFAULT 'DOCTORS',
ADD COLUMN     "enRouteAt" TIMESTAMP(3),
ADD COLUMN     "etaMinutes" INTEGER,
ADD COLUMN     "homeState" TEXT,
ADD COLUMN     "homeSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceLocation" TEXT NOT NULL DEFAULT 'IN_CLINIC',
ADD COLUMN     "visitDistrict" TEXT;

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "homeVisit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FlagDefinition" ADD COLUMN     "edition" TEXT,
ADD COLUMN     "gateIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "FlagGateEvidence" DROP CONSTRAINT "FlagGateEvidence_pkey",
ADD CONSTRAINT "FlagGateEvidence_pkey" PRIMARY KEY ("flagKey", "gateId");

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "heldForReviewAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewState" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "assignsClinician" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "careType" TEXT NOT NULL DEFAULT 'DOCTORS',
ADD COLUMN     "coverageDistricts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "edition" TEXT,
ADD COLUMN     "homeSurchargeMinor" INTEGER,
ADD COLUMN     "profession" TEXT,
ADD COLUMN     "serviceLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "verificationRegister" TEXT;

-- CreateTable
CREATE TABLE "PatientAddress" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "governorate" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "addressEnc" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedPhoneLast4" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingVisitAddress" (
    "bookingId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "governorate" TEXT,
    "district" TEXT NOT NULL,
    "addressEnc" TEXT,
    "maskAfter" TIMESTAMP(3),
    "maskedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingVisitAddress_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "SafetyAlert" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "eventId" TEXT,
    "bookingId" TEXT,
    "clinicId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "kind" TEXT NOT NULL,
    "district" TEXT,
    "deliverTo" TEXT[],
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliverWithinSeconds" INTEGER NOT NULL DEFAULT 60,
    "deliveredAt" TIMESTAMP(3),
    "deliveryMode" TEXT,
    "deliveryRef" TEXT,
    "deliveryError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RAISED',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "escalatedBy" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAlertAction" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyAlertAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyShare" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "consentAttestedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stoppedAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "lastNotifiedState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanBooking" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "typeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "visitDistrict" TEXT,
    "visitAddressId" TEXT,
    "preferredStartDate" TIMESTAMP(3),
    "notesEnc" TEXT,
    "kiorlyCarePlanId" TEXT,
    "endedReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePlanBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientAddress_sub_deletedAt_idx" ON "PatientAddress"("sub", "deletedAt");

-- CreateIndex
CREATE INDEX "BookingVisitAddress_maskAfter_maskedAt_idx" ON "BookingVisitAddress"("maskAfter", "maskedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyAlert_alertId_key" ON "SafetyAlert"("alertId");

-- CreateIndex
CREATE INDEX "SafetyAlert_status_raisedAt_idx" ON "SafetyAlert"("status", "raisedAt");

-- CreateIndex
CREATE INDEX "SafetyAlert_bookingId_idx" ON "SafetyAlert"("bookingId");

-- CreateIndex
CREATE INDEX "SafetyAlertAction_alertId_createdAt_idx" ON "SafetyAlertAction"("alertId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyShare_tokenHash_key" ON "FamilyShare"("tokenHash");

-- CreateIndex
CREATE INDEX "FamilyShare_bookingId_status_idx" ON "FamilyShare"("bookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyShare_bookingId_phoneHash_key" ON "FamilyShare"("bookingId", "phoneHash");

-- CreateIndex
CREATE INDEX "CarePlanBooking_sub_status_idx" ON "CarePlanBooking"("sub", "status");

-- CreateIndex
CREATE INDEX "BookingIntent_serviceLocation_status_idx" ON "BookingIntent"("serviceLocation", "status");

-- CreateIndex
CREATE INDEX "BookingIntent_carePlanId_idx" ON "BookingIntent"("carePlanId");

-- CreateIndex
CREATE INDEX "Provider_careType_status_idx" ON "Provider"("careType", "status");

-- AddForeignKey
ALTER TABLE "SafetyAlertAction" ADD CONSTRAINT "SafetyAlertAction_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "SafetyAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

