-- 1.8.0: OUT_FOR_DELIVERY mirror, itemised partial-fulfilment settlement, ops-editable policy overrides.
ALTER TABLE "PharmacyOrder" ADD COLUMN "outForDeliveryAt" TIMESTAMP(3);
ALTER TABLE "PharmacyOrder" ADD COLUMN "settlement" JSONB;

CREATE TABLE "PolicySetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "value" JSONB NOT NULL,
    "note" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolicySetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicySetting_key_scope_scopeId_key" ON "PolicySetting"("key", "scope", "scopeId");
