-- MSG-REAL: real messaging channels. Additive only.
CREATE TABLE "WhatsappContactWindow" (
  "market" TEXT NOT NULL DEFAULT 'EG',
  "addressHash" TEXT NOT NULL,
  "lastInboundAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsappContactWindow_pkey" PRIMARY KEY ("market","addressHash")
);
CREATE INDEX "WhatsappContactWindow_lastInboundAt_idx" ON "WhatsappContactWindow"("lastInboundAt");

CREATE TABLE "WhatsappTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "metaName" TEXT NOT NULL,
  "metaTemplateId" TEXT,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "quality" TEXT,
  "reason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "statusAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsappTemplate_status_check" CHECK ("status" IN ('DRAFT','SUBMITTED','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','FLAGGED')),
  CONSTRAINT "WhatsappTemplate_category_check" CHECK ("category" IN ('UTILITY','MARKETING','AUTHENTICATION'))
);
CREATE UNIQUE INDEX "WhatsappTemplate_metaName_language_key" ON "WhatsappTemplate"("metaName","language");
CREATE INDEX "WhatsappTemplate_key_language_idx" ON "WhatsappTemplate"("key","language");

CREATE TABLE "MessagingChannelState" (
  "channel" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessagingChannelState_pkey" PRIMARY KEY ("channel","key")
);

-- Replay / duplicate protection for inbound provider messages (Meta redelivers a webhook until it gets 200): one IN row per (channel, provider message id).
CREATE UNIQUE INDEX "MessageLog_inbound_providerRef_key" ON "MessageLog"("channel","providerRef") WHERE "direction" = 'IN' AND "providerRef" IS NOT NULL;
