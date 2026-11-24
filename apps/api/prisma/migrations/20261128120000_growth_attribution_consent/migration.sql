-- GRW-P1-B (attribution core) and GRW-P1-I (consent and preference centre). Additive and idempotent.

-- B: provider link code -> owning organisation (Kiorex learns it from the Clinic projection; unknown codes are ignored by the touch endpoint).
ALTER TABLE "GrowthAcquisitionSource" ADD COLUMN IF NOT EXISTS "ownerOrgRef" TEXT;
CREATE INDEX IF NOT EXISTS "GrowthAcquisitionSource_ownerOrgRef_idx" ON "GrowthAcquisitionSource"("ownerOrgRef");

-- B: idempotent event ingestion and duplicate suppression across web, mobile, messaging and backend (same fact = same key).
ALTER TABLE "GrowthEvent" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthEvent_dedupeKey_key" ON "GrowthEvent"("dedupeKey");

-- B: replay support on the (append-only) decision: the winning touch and the booking subset the function saw. Adding nullable columns is not an UPDATE.
ALTER TABLE "GrowthAttributionDecision" ADD COLUMN IF NOT EXISTS "winningTouchId" TEXT,
ADD COLUMN IF NOT EXISTS "bookingSnapshot" JSONB;

-- B: a correction may use the SAME policy version as the decision it supersedes, so uniqueness is per ORIGINAL decision (supersedesId IS NULL),
-- and a decision can be superseded only once (two concurrent corrections cannot both win).
DROP INDEX IF EXISTS "GrowthAttributionDecision_bookingId_policyVersionId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthAttributionDecision_original_per_version_idx" ON "GrowthAttributionDecision"("bookingId", "policyVersionId") WHERE "supersedesId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthAttributionDecision_one_correction_idx" ON "GrowthAttributionDecision"("supersedesId") WHERE "supersedesId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "GrowthAttributionDecision_bookingId_policyVersionId_idx" ON "GrowthAttributionDecision"("bookingId", "policyVersionId");

-- B: provider-facing announcement text for money-policy changes (ATTRIBUTION_POLICY needs effectiveFrom >= now + 7 days and an announcement).
ALTER TABLE "GrowthConfigVersion" ADD COLUMN IF NOT EXISTS "announcement" TEXT;

-- I: consent record fields (ARCH section 9): channel, rotating ip hash, button evidence. version = textVersion, source, createdAt = at.
ALTER TABLE "ConsentRecord" ADD COLUMN IF NOT EXISTS "channel" TEXT,
ADD COLUMN IF NOT EXISTS "ipHash" TEXT,
ADD COLUMN IF NOT EXISTS "evidence" TEXT;
CREATE INDEX IF NOT EXISTS "ConsentRecord_purpose_channel_createdAt_idx" ON "ConsentRecord"("purpose", "channel", "createdAt");

-- I: anonymous visitor consent audit (no sub, no cookie value): one row per banner decision, keyed by a random consent id.
CREATE TABLE IF NOT EXISTS "GrowthVisitorConsent" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "analytics" BOOLEAN NOT NULL,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "textVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "evidence" TEXT,
    "ipHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthVisitorConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GrowthVisitorConsent_createdAt_idx" ON "GrowthVisitorConsent"("createdAt");

-- I: the consent history is an audit trail: rows are never changed or removed (a withdrawal is a new row; the latest row wins).
CREATE OR REPLACE FUNCTION growth_consent_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed (a withdrawal is a new row)', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END $$;
DROP TRIGGER IF EXISTS consent_record_immutable ON "ConsentRecord";
CREATE TRIGGER consent_record_immutable BEFORE UPDATE OR DELETE ON "ConsentRecord" FOR EACH ROW EXECUTE FUNCTION growth_consent_audit_guard();
DROP TRIGGER IF EXISTS growth_visitor_consent_immutable ON "GrowthVisitorConsent";
CREATE TRIGGER growth_visitor_consent_immutable BEFORE UPDATE OR DELETE ON "GrowthVisitorConsent" FOR EACH ROW EXECUTE FUNCTION growth_consent_audit_guard();
