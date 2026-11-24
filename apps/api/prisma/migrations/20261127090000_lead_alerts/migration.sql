-- Lead alerts: ops team contacts, the alert settings singleton and the per-recipient delivery ledger (additive).
CREATE TABLE "OpsStaffContact" (
    "sub" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "roles" TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'en',
    "leadAlerts" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[] DEFAULT ARRAY['EMAIL', 'WHATSAPP', 'PUSH']::TEXT[],
    "leadsSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsStaffContact_pkey" PRIMARY KEY ("sub")
);
CREATE TABLE "LeadAlertConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[] DEFAULT ARRAY['EMAIL', 'WHATSAPP', 'PUSH']::TEXT[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadAlertConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LeadAlertDelivery" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffSub" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadAlertDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadAlertDelivery_dedupeKey_key" ON "LeadAlertDelivery"("dedupeKey");
CREATE INDEX "LeadAlertDelivery_status_scheduledFor_idx" ON "LeadAlertDelivery"("status", "scheduledFor");
CREATE INDEX "LeadAlertDelivery_leadId_idx" ON "LeadAlertDelivery"("leadId");
