-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "orderRef" TEXT,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'DEPOSIT';

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "sub" TEXT,
    "recipient" TEXT,
    "recipientMasked" TEXT NOT NULL,
    "templateId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelConversation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "phone" TEXT NOT NULL,
    "sub" TEXT,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "context" JSONB,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "lastInboundAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "dependantId" TEXT,
    "providerId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "tenantId" TEXT,
    "typeId" TEXT NOT NULL,
    "preferredFrom" TIMESTAMP(3),
    "preferredTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistOffer" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedRecord" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clinicId" TEXT,
    "kiorlyPatientId" TEXT,
    "sourceRef" TEXT,
    "sourceEventId" TEXT,
    "title" TEXT,
    "payloadEnc" TEXT,
    "signedAt" TIMESTAMP(3),
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordShareConsent" (
    "sub" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordShareConsent_pkey" PRIMARY KEY ("sub","scope")
);

-- CreateTable
CREATE TABLE "FollowUpReminder" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "recordId" TEXT,
    "clinicId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PATIENT',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyCart" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "pharmacyId" TEXT,
    "items" JSONB NOT NULL,
    "deliveryMethod" TEXT,
    "deliveryAddress" JSONB,
    "prescriptionRecordId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyCart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyOrder" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "deliveryMethod" TEXT NOT NULL,
    "deliveryAddress" JSONB,
    "prescriptionRecordId" TEXT,
    "rxStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "partnerOrderId" TEXT,
    "paymentId" TEXT,
    "takeRateBps" INTEGER NOT NULL DEFAULT 0,
    "platformFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "readyAt" TIMESTAMP(3),
    "dispensedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabBooking" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "tests" JSONB NOT NULL,
    "collectionType" TEXT NOT NULL,
    "slotStartsAt" TIMESTAMP(3) NOT NULL,
    "slotEndsAt" TIMESTAMP(3) NOT NULL,
    "address" JSONB,
    "status" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "collectionFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "paymentId" TEXT,
    "partnerOrderId" TEXT,
    "takeRateBps" INTEGER NOT NULL DEFAULT 0,
    "platformFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "resultRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeleSession" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "videoProvider" TEXT NOT NULL DEFAULT 'mock',
    "roomName" TEXT NOT NULL,
    "scheduledStartsAt" TIMESTAMP(3) NOT NULL,
    "patientJoinedAt" TIMESTAMP(3),
    "clinicianJoinedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "consultFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeleSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageLog_channel_createdAt_idx" ON "MessageLog"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_recipient_createdAt_idx" ON "MessageLog"("recipient", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_status_createdAt_idx" ON "MessageLog"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConversation_channel_phone_key" ON "ChannelConversation"("channel", "phone");

-- CreateIndex
CREATE INDEX "WaitlistEntry_providerId_status_idx" ON "WaitlistEntry"("providerId", "status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_sub_status_idx" ON "WaitlistEntry"("sub", "status");

-- CreateIndex
CREATE INDEX "WaitlistOffer_status_expiresAt_idx" ON "WaitlistOffer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistOffer_entryId_startsAt_key" ON "WaitlistOffer"("entryId", "startsAt");

-- CreateIndex
CREATE INDEX "SharedRecord_sub_status_createdAt_idx" ON "SharedRecord"("sub", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SharedRecord_kiorlyPatientId_idx" ON "SharedRecord"("kiorlyPatientId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedRecord_sub_kind_sourceRef_key" ON "SharedRecord"("sub", "kind", "sourceRef");

-- CreateIndex
CREATE INDEX "FollowUpReminder_sub_status_dueAt_idx" ON "FollowUpReminder"("sub", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyCart_sub_key" ON "PharmacyCart"("sub");

-- CreateIndex
CREATE INDEX "PharmacyOrder_sub_status_idx" ON "PharmacyOrder"("sub", "status");

-- CreateIndex
CREATE INDEX "PharmacyOrder_partnerOrderId_idx" ON "PharmacyOrder"("partnerOrderId");

-- CreateIndex
CREATE INDEX "LabBooking_sub_status_idx" ON "LabBooking"("sub", "status");

-- CreateIndex
CREATE INDEX "LabBooking_partnerOrderId_idx" ON "LabBooking"("partnerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "TeleSession_bookingId_key" ON "TeleSession"("bookingId");

-- CreateIndex
CREATE INDEX "TeleSession_sub_status_idx" ON "TeleSession"("sub", "status");

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

