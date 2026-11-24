-- Link registry (contracts 1.11.0, GRW-P1-C follow-up). Additive and idempotent.
-- A provider link code now carries the state the Clinic reports: ACTIVE, PAUSED or REVOKED (events ReferralLinkCreated / ReferralLinkRevoked and the signed
-- lookup GET /marketplace/v1/referral-links/{code}). A REVOKED or PAUSED code never makes a NEW booking provider-led; existing decisions are append-only and untouched.
ALTER TABLE "GrowthAcquisitionSource" ADD COLUMN IF NOT EXISTS "linkStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "GrowthAcquisitionSource" ADD COLUMN IF NOT EXISTS "linkRevokedAt" TIMESTAMP(3);
ALTER TABLE "GrowthAcquisitionSource" ADD COLUMN IF NOT EXISTS "registryCheckedAt" TIMESTAMP(3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthAcquisitionSource_linkStatus_check') THEN
    ALTER TABLE "GrowthAcquisitionSource" ADD CONSTRAINT "GrowthAcquisitionSource_linkStatus_check" CHECK ("linkStatus" IN ('ACTIVE','PAUSED','REVOKED'));
  END IF;
END $$;
