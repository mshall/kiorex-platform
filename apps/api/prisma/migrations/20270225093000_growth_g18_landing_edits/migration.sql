-- G-18: editorial override of the title and description of a generated listing page (hub, city, district, care-district, location hubs, same-day, telemedicine), per locale.
-- Maker-checker (the approver is a different person, also a CHECK), a content quality gate runs on submit (stored result), one ACTIVE edit per page and locale, withdrawable.
-- Provider-owned entity pages (doctor, clinic, nurse, pharmacy, lab) cannot be edited here. Additive.
CREATE TABLE IF NOT EXISTS "GrowthLandingEdit" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "pageKey" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "quality" JSONB,
    "createdBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthLandingEdit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthLandingEdit_page_version_key" ON "GrowthLandingEdit"("market", "pageKey", "locale", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthLandingEdit_one_active" ON "GrowthLandingEdit"("market", "pageKey", "locale") WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "GrowthLandingEdit_status_idx" ON "GrowthLandingEdit"("market", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthLandingEdit_status_check') THEN ALTER TABLE "GrowthLandingEdit" ADD CONSTRAINT "GrowthLandingEdit_status_check" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','ACTIVE','REJECTED','SUPERSEDED','WITHDRAWN')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthLandingEdit_locale_check') THEN ALTER TABLE "GrowthLandingEdit" ADD CONSTRAINT "GrowthLandingEdit_locale_check" CHECK ("locale" IN ('ar','en')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthLandingEdit_maker_checker') THEN ALTER TABLE "GrowthLandingEdit" ADD CONSTRAINT "GrowthLandingEdit_maker_checker" CHECK ("status" <> 'ACTIVE' OR ("decidedBy" IS NOT NULL AND "decidedBy" <> "createdBy")); END IF;
END $$;
