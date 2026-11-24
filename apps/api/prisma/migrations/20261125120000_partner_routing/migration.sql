-- Per-registration routing for pharmacy / lab traffic (several live partners of one kind).
-- AlterTable
ALTER TABLE "PharmacyCart" ADD COLUMN "registrationId" TEXT;
ALTER TABLE "PharmacyOrder" ADD COLUMN "registrationId" TEXT;
ALTER TABLE "LabBooking" ADD COLUMN "registrationId" TEXT;

-- CreateIndex
CREATE INDEX "PharmacyOrder_registrationId_idx" ON "PharmacyOrder"("registrationId");
CREATE INDEX "LabBooking_registrationId_idx" ON "LabBooking"("registrationId");

-- Backfill: until now every call went to the FIRST ACTIVE registration of the kind, so that registration owns every existing cart, order and booking.
-- With no registration (env defaults) the column stays NULL and the runtime keeps routing such rows to the default connection.
UPDATE "PharmacyCart"  SET "registrationId" = (SELECT "id" FROM "PartnerRegistration" WHERE "kind" = 'PHARMACY' AND "active" = true ORDER BY "createdAt" ASC LIMIT 1) WHERE "registrationId" IS NULL;
UPDATE "PharmacyOrder" SET "registrationId" = (SELECT "id" FROM "PartnerRegistration" WHERE "kind" = 'PHARMACY' AND "active" = true ORDER BY "createdAt" ASC LIMIT 1) WHERE "registrationId" IS NULL;
UPDATE "LabBooking"    SET "registrationId" = (SELECT "id" FROM "PartnerRegistration" WHERE "kind" = 'LAB' AND "active" = true ORDER BY "createdAt" ASC LIMIT 1) WHERE "registrationId" IS NULL;
