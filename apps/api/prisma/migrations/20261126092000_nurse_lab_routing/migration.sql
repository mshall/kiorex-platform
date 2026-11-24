-- Per-registration routing for the Nurse -> Lab relay (LAB_NURSE), like pharmacy and lab.
ALTER TABLE "PartnerRegistration" ADD COLUMN "labRegistrationId" TEXT;
ALTER TABLE "NurseLabRelay" ADD COLUMN "registrationId" TEXT;
CREATE INDEX "NurseLabRelay_registrationId_idx" ON "NurseLabRelay"("registrationId");

-- Backfill: until now every nurse call went to the FIRST ACTIVE LAB_NURSE registration, so it owns every existing relay row, and it belongs to the oldest active LAB registration.
UPDATE "PartnerRegistration" SET "labRegistrationId" = (SELECT "id" FROM "PartnerRegistration" l WHERE l."kind" = 'LAB' AND l."active" = true ORDER BY l."createdAt" ASC LIMIT 1) WHERE "kind" = 'LAB_NURSE' AND "labRegistrationId" IS NULL;
UPDATE "NurseLabRelay" SET "registrationId" = (SELECT "id" FROM "PartnerRegistration" WHERE "kind" = 'LAB_NURSE' AND "active" = true ORDER BY "createdAt" ASC LIMIT 1) WHERE "registrationId" IS NULL AND "partnerOrderId" IS NOT NULL;
