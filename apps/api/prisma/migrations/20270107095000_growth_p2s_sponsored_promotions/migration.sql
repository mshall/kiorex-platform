-- GRW-P2-S (wave 7 lane A2), KP side: the Kiorex projection of a provider-owned sponsored promotion, the per-booking sponsored discount line and the Kiorex review record. Schema owned by the W7 owner (lane A1) on A2's request.
-- Additive and idempotent. A provider-sponsored promotion is a discount the CLINIC funds: nothing here references the patient credit tables (RewardLot, RewardLedgerEntry) and the patient never holds provider credit (RC-S5).
-- The Clinic is the system of record of the budget and the wallet; this is a signed projection for quoting and display, plus Kiorex's own review decisions and the line on the booking.

CREATE TABLE IF NOT EXISTS "SponsoredPromotionProjection" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "promotionId" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL DEFAULT '',
    "nameEn" TEXT NOT NULL DEFAULT '',
    "patientCopyAr" TEXT NOT NULL DEFAULT '',
    "patientCopyEn" TEXT NOT NULL DEFAULT '',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "discount" JSONB NOT NULL DEFAULT '{}',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "budgetCapMinor" BIGINT NOT NULL DEFAULT 0,
    "fundingMode" TEXT NOT NULL DEFAULT 'WALLET_ONLY',
    "referencePriceMinor" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SponsoredPromotionProjection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SponsoredPromotionProjection_promotionId_version_key" ON "SponsoredPromotionProjection"("promotionId", "version");
CREATE INDEX IF NOT EXISTS "SponsoredPromotionProjection_orgRef_status_idx" ON "SponsoredPromotionProjection"("orgRef", "status");

CREATE TABLE IF NOT EXISTS "BookingSponsoredDiscount" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "bookingIntentId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "promotionVersion" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "reservationRef" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RESERVED',
    "debitRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingSponsoredDiscount_pkey" PRIMARY KEY ("id")
);
-- one sponsored promotion per booking (no stacking) and one line per reservation
CREATE UNIQUE INDEX IF NOT EXISTS "BookingSponsoredDiscount_bookingIntentId_key" ON "BookingSponsoredDiscount"("bookingIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "BookingSponsoredDiscount_reservationRef_key" ON "BookingSponsoredDiscount"("reservationRef");
CREATE INDEX IF NOT EXISTS "BookingSponsoredDiscount_promotionId_state_idx" ON "BookingSponsoredDiscount"("promotionId", "state");

CREATE TABLE IF NOT EXISTS "SponsoredPromotionReview" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "promotionId" TEXT NOT NULL,
    "promotionVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "guardResult" JSONB NOT NULL DEFAULT '{}',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decision" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "SponsoredPromotionReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SponsoredPromotionReview_promotion_idx" ON "SponsoredPromotionReview"("promotionId", "promotionVersion");
CREATE INDEX IF NOT EXISTS "SponsoredPromotionReview_decision_idx" ON "SponsoredPromotionReview"("decision", "createdAt");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('SponsoredPromotionProjection', 'SponsoredPromotionProjection_status_check', '"status" IN (''DRAFT'',''SUBMITTED'',''IN_REVIEW'',''APPROVED'',''ACTIVE'',''PAUSED'',''EXHAUSTED'',''EXPIRED'',''REJECTED'',''ARCHIVED'')'),
    ('SponsoredPromotionProjection', 'SponsoredPromotionProjection_funding_check', '"fundingMode" IN (''WALLET_ONLY'',''WALLET_THEN_INVOICE'')'),
    ('SponsoredPromotionProjection', 'SponsoredPromotionProjection_window_check', '"startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"'),
    ('SponsoredPromotionProjection', 'SponsoredPromotionProjection_values_check', '"version" >= 1 AND "budgetCapMinor" >= 0 AND "referencePriceMinor" >= 0'),
    ('BookingSponsoredDiscount', 'BookingSponsoredDiscount_state_check', '"state" IN (''RESERVED'',''APPLIED'',''DEBITED'',''RELEASED'',''REVERSED'')'),
    ('BookingSponsoredDiscount', 'BookingSponsoredDiscount_amount_check', '"amountMinor" > 0 AND "promotionVersion" >= 1'),
    ('BookingSponsoredDiscount', 'BookingSponsoredDiscount_debit_check', '"state" NOT IN (''DEBITED'',''REVERSED'') OR "debitRef" IS NOT NULL'),
    ('SponsoredPromotionReview', 'SponsoredPromotionReview_kind_check', '"kind" IN (''CONTENT'',''SCOPE'',''HIGH_VALUE'')'),
    ('SponsoredPromotionReview', 'SponsoredPromotionReview_decision_check', '"decision" IS NULL OR "decision" IN (''APPROVED'',''REJECTED'')'),
    ('SponsoredPromotionReview', 'SponsoredPromotionReview_maker_checker_check', '"decidedBy" IS NULL OR "decidedBy" <> "requestedBy"'),
    ('SponsoredPromotionReview', 'SponsoredPromotionReview_decided_check', '("decidedBy" IS NULL) = ("decision" IS NULL)')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- a decided review never changes again
CREATE OR REPLACE FUNCTION sponsored_promotion_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SponsoredPromotionReview is append-only: DELETE is not allowed' USING ERRCODE = '55000'; END IF;
  IF OLD."decision" IS NOT NULL THEN RAISE EXCEPTION 'SponsoredPromotionReview % is already decided', OLD."id" USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sponsored_promotion_review_guard ON "SponsoredPromotionReview";
CREATE TRIGGER sponsored_promotion_review_guard BEFORE UPDATE OR DELETE ON "SponsoredPromotionReview" FOR EACH ROW EXECUTE FUNCTION sponsored_promotion_review_guard();

-- the state of a booking line only moves forward: RESERVED -> APPLIED -> DEBITED -> REVERSED, or RESERVED/APPLIED -> RELEASED; amount and promotion never change
CREATE OR REPLACE FUNCTION booking_sponsored_discount_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BookingSponsoredDiscount is append-only: DELETE is not allowed' USING ERRCODE = '55000'; END IF;
  IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."promotionId" <> OLD."promotionId" OR NEW."promotionVersion" <> OLD."promotionVersion" OR NEW."bookingIntentId" <> OLD."bookingIntentId" OR NEW."reservationRef" <> OLD."reservationRef" THEN
    RAISE EXCEPTION 'BookingSponsoredDiscount % amount, promotion and booking are fixed', OLD."id" USING ERRCODE = '55000';
  END IF;
  IF NEW."state" <> OLD."state" AND NOT (
       (OLD."state" = 'RESERVED' AND NEW."state" IN ('APPLIED','RELEASED','DEBITED'))
    OR (OLD."state" = 'APPLIED' AND NEW."state" IN ('DEBITED','RELEASED'))
    OR (OLD."state" = 'DEBITED' AND NEW."state" = 'REVERSED')) THEN
    RAISE EXCEPTION 'BookingSponsoredDiscount % cannot move from % to %', OLD."id", OLD."state", NEW."state" USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS booking_sponsored_discount_guard ON "BookingSponsoredDiscount";
CREATE TRIGGER booking_sponsored_discount_guard BEFORE UPDATE OR DELETE ON "BookingSponsoredDiscount" FOR EACH ROW EXECUTE FUNCTION booking_sponsored_discount_guard();
