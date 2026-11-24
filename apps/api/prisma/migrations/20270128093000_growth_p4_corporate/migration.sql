-- GRW-P4-C corporate partnerships and enterprise acquisition (Kiorex side).
-- Seven tables plus an own append-only benefit ledger. The corporate benefit is NOT patient credit and NOT provider credit: nothing here writes RewardLot, RewardLedgerEntry or any Clinic table,
-- and no column holds a balance. Company data only; a member is a keyed hash; the employer-facing reports are aggregate with k >= 10 (enforced in the service and tested).
-- Idempotent: every statement can be replayed (IF NOT EXISTS, guarded constraints, OR REPLACE functions, DROP IF EXISTS before CREATE TRIGGER).
-- Non-Prisma objects below (documented for the schema drift check): CHECK constraints, a partial unique index (one ACTIVE membership per person), the ledger guard trigger and the append-only triggers.

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateAccount" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "displayName" TEXT NOT NULL,
    "legalNameRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "contractRef" TEXT,
    "fundingMode" TEXT NOT NULL DEFAULT 'SPONSOR_CREDIT',
    "billingContactRef" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "sponsorCeilingMinor" INTEGER,
    "perMemberCapMinor" INTEGER,
    "perVisitMaxMinor" INTEGER,
    "coverBp" INTEGER,
    "emailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "termsEditedBy" TEXT,
    "termsEditedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateCode" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OPEN',
    "maxRedemptions" INTEGER NOT NULL,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "perMemberCapMinor" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "subHash" TEXT NOT NULL,
    "codeId" TEXT,
    "verifiedBy" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "perMemberCapMinor" INTEGER,

    CONSTRAINT "CorporateMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateBenefitEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "bookingId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateBenefitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateHrBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rowCount" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "windowEndsAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateHrBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateHrEntry" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3),

    CONSTRAINT "CorporateHrEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateLead" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "source" TEXT NOT NULL,
    "referrerOrgRef" TEXT,
    "referralRef" TEXT,
    "companyName" TEXT NOT NULL,
    "sizeBucket" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "contactRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "ownerSub" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateLeadHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateLeadHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorporateInvoiceNote" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sponsorSpendMinor" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateInvoiceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateAccount_market_status_idx" ON "CorporateAccount"("market", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateCode_codeHash_key" ON "CorporateCode"("codeHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateCode_accountId_status_idx" ON "CorporateCode"("accountId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateMember_accountId_endedAt_idx" ON "CorporateMember"("accountId", "endedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateMember_subHash_idx" ON "CorporateMember"("subHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateMember_accountId_subHash_idx" ON "CorporateMember"("accountId", "subHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateBenefitEntry_idempotencyKey_key" ON "CorporateBenefitEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateBenefitEntry_accountId_createdAt_idx" ON "CorporateBenefitEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateBenefitEntry_memberId_idx" ON "CorporateBenefitEntry"("memberId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateBenefitEntry_bookingId_idx" ON "CorporateBenefitEntry"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateHrBatch_accountId_status_idx" ON "CorporateHrBatch"("accountId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateHrEntry_keyHash_idx" ON "CorporateHrEntry"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateHrEntry_batchId_keyHash_key" ON "CorporateHrEntry"("batchId", "keyHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateLead_referralRef_key" ON "CorporateLead"("referralRef");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateLead_status_createdAt_idx" ON "CorporateLead"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateLead_source_status_idx" ON "CorporateLead"("source", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorporateLeadHistory_leadId_at_idx" ON "CorporateLeadHistory"("leadId", "at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateInvoiceNote_accountId_month_key" ON "CorporateInvoiceNote"("accountId", "month");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateCode_accountId_fkey') THEN ALTER TABLE "CorporateCode" ADD CONSTRAINT "CorporateCode_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CorporateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateMember_accountId_fkey') THEN ALTER TABLE "CorporateMember" ADD CONSTRAINT "CorporateMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CorporateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateHrBatch_accountId_fkey') THEN ALTER TABLE "CorporateHrBatch" ADD CONSTRAINT "CorporateHrBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CorporateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateHrEntry_batchId_fkey') THEN ALTER TABLE "CorporateHrEntry" ADD CONSTRAINT "CorporateHrEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CorporateHrBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateLeadHistory_leadId_fkey') THEN ALTER TABLE "CorporateLeadHistory" ADD CONSTRAINT "CorporateLeadHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CorporateLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateInvoiceNote_accountId_fkey') THEN ALTER TABLE "CorporateInvoiceNote" ADD CONSTRAINT "CorporateInvoiceNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CorporateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;



-- ── constraints that Prisma cannot express ──
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateAccount_status_check') THEN ALTER TABLE "CorporateAccount" ADD CONSTRAINT "CorporateAccount_status_check" CHECK ("status" IN ('LEAD','ACTIVE','PAUSED','ENDED')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateAccount_funding_check') THEN ALTER TABLE "CorporateAccount" ADD CONSTRAINT "CorporateAccount_funding_check" CHECK ("fundingMode" IN ('SPONSOR_CREDIT','PLATFORM_PROMO')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateAccount_terms_check') THEN ALTER TABLE "CorporateAccount" ADD CONSTRAINT "CorporateAccount_terms_check" CHECK (
  ("sponsorCeilingMinor" IS NULL OR "sponsorCeilingMinor" >= 0) AND ("perMemberCapMinor" IS NULL OR "perMemberCapMinor" >= 0) AND ("perVisitMaxMinor" IS NULL OR "perVisitMaxMinor" >= 0)
  AND ("coverBp" IS NULL OR ("coverBp" BETWEEN 1 AND 10000))); END IF; END $$;
-- ACTIVE needs complete terms, a contract reference and a second person (the activator is not the last editor of the terms): the database says no even if a service forgets.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateAccount_active_check') THEN ALTER TABLE "CorporateAccount" ADD CONSTRAINT "CorporateAccount_active_check" CHECK ("status" <> 'ACTIVE' OR (
  "contractRef" IS NOT NULL AND length(btrim("contractRef")) > 0 AND "sponsorCeilingMinor" IS NOT NULL AND "sponsorCeilingMinor" > 0 AND "perMemberCapMinor" IS NOT NULL AND "perMemberCapMinor" > 0
  AND "coverBp" IS NOT NULL AND "activatedBy" IS NOT NULL AND "activatedBy" IS DISTINCT FROM "termsEditedBy")); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateCode_kind_check') THEN ALTER TABLE "CorporateCode" ADD CONSTRAINT "CorporateCode_kind_check" CHECK ("kind" IN ('OPEN','LIST')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateCode_status_check') THEN ALTER TABLE "CorporateCode" ADD CONSTRAINT "CorporateCode_status_check" CHECK ("status" IN ('ACTIVE','REVOKED')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateCode_counts_check') THEN ALTER TABLE "CorporateCode" ADD CONSTRAINT "CorporateCode_counts_check" CHECK ("maxRedemptions" >= 1 AND "redeemedCount" >= 0 AND "redeemedCount" <= "maxRedemptions"); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateMember_verified_check') THEN ALTER TABLE "CorporateMember" ADD CONSTRAINT "CorporateMember_verified_check" CHECK ("verifiedBy" IN ('DOMAIN_EMAIL','HR_LIST','CODE')); END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateMember_one_active_per_person" ON "CorporateMember" ("subHash") WHERE "endedAt" IS NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateBenefitEntry_type_check') THEN ALTER TABLE "CorporateBenefitEntry" ADD CONSTRAINT "CorporateBenefitEntry_type_check" CHECK ("type" IN ('RESERVE','REDEEM','RELEASE','REVERSE')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateBenefitEntry_amount_check') THEN ALTER TABLE "CorporateBenefitEntry" ADD CONSTRAINT "CorporateBenefitEntry_amount_check" CHECK ("amountMinor" > 0); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateHrBatch_status_check') THEN ALTER TABLE "CorporateHrBatch" ADD CONSTRAINT "CorporateHrBatch_status_check" CHECK ("status" IN ('PENDING_APPROVAL','APPROVED','REJECTED','PURGED')); END IF; END $$;
-- two-person rule on the HR list: the approver is not the uploader
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateHrBatch_two_person_check') THEN ALTER TABLE "CorporateHrBatch" ADD CONSTRAINT "CorporateHrBatch_two_person_check" CHECK ("approvedBy" IS NULL OR "approvedBy" <> "uploadedBy"); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateLead_source_check') THEN ALTER TABLE "CorporateLead" ADD CONSTRAINT "CorporateLead_source_check" CHECK ("source" IN ('B2B_REFERRAL','OUTBOUND','INBOUND')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateLead_status_check') THEN ALTER TABLE "CorporateLead" ADD CONSTRAINT "CorporateLead_status_check" CHECK ("status" IN ('NEW','CONTACTED','QUALIFIED','PROPOSAL','WON','LOST','DUPLICATE')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorporateInvoiceNote_month_check') THEN ALTER TABLE "CorporateInvoiceNote" ADD CONSTRAINT "CorporateInvoiceNote_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "sponsorSpendMinor" >= 0); END IF; END $$;

-- ── the corporate benefit ledger guard ──
-- Serialises on the account row, then enforces: one live reservation per booking; the ceiling of the account; the cap of the member; and never more released, redeemed or reversed than exists.
-- used(account) = RESERVE - RELEASE - REVERSE. The messages start with the machine code the service maps to a 409.
CREATE OR REPLACE FUNCTION corporate_benefit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a RECORD; m RECORD;
  v_used bigint; v_member_used bigint; v_res bigint; v_rel bigint; v_red bigint; v_rev bigint; v_cap bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND current_setting('kx.growth_ledger_purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'CorporateBenefitEntry is append-only: % is not allowed (append a RELEASE or REVERSE entry)', TG_OP USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM "CorporateAccount" WHERE "id" = NEW."accountId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_ACCOUNT_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  SELECT * INTO m FROM "CorporateMember" WHERE "id" = NEW."memberId";
  IF NOT FOUND OR m."accountId" <> NEW."accountId" THEN RAISE EXCEPTION 'CORPORATE_MEMBER_MISMATCH: the member does not belong to the account' USING ERRCODE = '23514'; END IF;
  SELECT coalesce(sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" ELSE 0 END), 0), coalesce(sum(CASE "type" WHEN 'RELEASE' THEN "amountMinor" ELSE 0 END), 0),
         coalesce(sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" ELSE 0 END), 0), coalesce(sum(CASE "type" WHEN 'REVERSE' THEN "amountMinor" ELSE 0 END), 0)
    INTO v_res, v_rel, v_red, v_rev FROM "CorporateBenefitEntry" WHERE "accountId" = NEW."accountId" AND "bookingId" = NEW."bookingId";
  IF NEW."type" = 'RESERVE' THEN
    IF v_res - v_rel - v_rev > 0 THEN RAISE EXCEPTION 'CORPORATE_ALREADY_RESERVED: this booking already carries a corporate benefit' USING ERRCODE = '23514'; END IF;
    IF a."sponsorCeilingMinor" IS NULL THEN RAISE EXCEPTION 'CORPORATE_TERMS_INCOMPLETE: the account has no ceiling' USING ERRCODE = '23514'; END IF;
    SELECT coalesce(sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'RELEASE' THEN -"amountMinor" WHEN 'REVERSE' THEN -"amountMinor" ELSE 0 END), 0) INTO v_used FROM "CorporateBenefitEntry" WHERE "accountId" = NEW."accountId";
    IF v_used + NEW."amountMinor" > a."sponsorCeilingMinor" THEN RAISE EXCEPTION 'CORPORATE_CEILING_EXCEEDED: used % + % exceeds the ceiling %', v_used, NEW."amountMinor", a."sponsorCeilingMinor" USING ERRCODE = '23514'; END IF;
    v_cap := coalesce(m."perMemberCapMinor", a."perMemberCapMinor");
    IF v_cap IS NULL THEN RAISE EXCEPTION 'CORPORATE_TERMS_INCOMPLETE: no per-member cap' USING ERRCODE = '23514'; END IF;
    SELECT coalesce(sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'RELEASE' THEN -"amountMinor" WHEN 'REVERSE' THEN -"amountMinor" ELSE 0 END), 0) INTO v_member_used FROM "CorporateBenefitEntry" WHERE "memberId" = NEW."memberId";
    IF v_member_used + NEW."amountMinor" > v_cap THEN RAISE EXCEPTION 'CORPORATE_MEMBER_CAP_EXCEEDED: used % + % exceeds the cap %', v_member_used, NEW."amountMinor", v_cap USING ERRCODE = '23514'; END IF;
  ELSIF NEW."type" IN ('RELEASE', 'REDEEM') THEN
    IF NEW."amountMinor" > v_res - v_rel - v_red THEN RAISE EXCEPTION 'CORPORATE_NOTHING_HELD: % exceeds what is held on the booking (%)', NEW."amountMinor", v_res - v_rel - v_red USING ERRCODE = '23514'; END IF;
  ELSIF NEW."type" = 'REVERSE' THEN
    IF NEW."amountMinor" > v_red - v_rev THEN RAISE EXCEPTION 'CORPORATE_NOTHING_REDEEMED: % exceeds what was redeemed on the booking (%)', NEW."amountMinor", v_red - v_rev USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS corporate_benefit_guard_ins ON "CorporateBenefitEntry";
CREATE TRIGGER corporate_benefit_guard_ins BEFORE INSERT ON "CorporateBenefitEntry" FOR EACH ROW EXECUTE FUNCTION corporate_benefit_guard();
DROP TRIGGER IF EXISTS corporate_benefit_immutable ON "CorporateBenefitEntry";
CREATE TRIGGER corporate_benefit_immutable BEFORE UPDATE OR DELETE ON "CorporateBenefitEntry" FOR EACH ROW EXECUTE FUNCTION corporate_benefit_guard();
DROP TRIGGER IF EXISTS corporate_lead_history_immutable ON "CorporateLeadHistory";
CREATE TRIGGER corporate_lead_history_immutable BEFORE UPDATE OR DELETE ON "CorporateLeadHistory" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();

-- ── erasure and retention (called by GrowthMaintenanceService after the older functions; this migration does not redefine them) ──
-- The member row is keyed by a hash only the application can compute, so the caller passes it. The ledger keeps its rows (accounting) with no person: they only name an opaque member id.
CREATE OR REPLACE FUNCTION growth_erase_corporate(p_sub_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_n int := 0;
BEGIN
  IF p_sub_hash IS NULL OR length(btrim(p_sub_hash)) = 0 THEN RAISE EXCEPTION 'growth_erase_corporate: sub hash is required' USING ERRCODE = '22023'; END IF;
  UPDATE "CorporateMember" SET "subHash" = 'erased:' || "id", "endedAt" = coalesce("endedAt", now()), "endReason" = coalesce("endReason", 'ERASED') WHERE "subHash" = p_sub_hash;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('corporateMembersAnonymised', v_n);
END $$;

-- HR list rows go when their match window ends (or at once for a rejected list); batches stay as a count. Ledger rows of an ENDED account are deleted after p_ledger_years.
CREATE OR REPLACE FUNCTION growth_purge_corporate(p_now timestamptz DEFAULT now(), p_ledger_years int DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_rows int := 0; v_batches int := 0; v_ledger int := 0;
BEGIN
  IF p_ledger_years < 1 THEN RAISE EXCEPTION 'growth_purge_corporate: years must be >= 1' USING ERRCODE = '22023'; END IF;
  UPDATE "CorporateHrBatch" SET "status" = 'PURGED', "purgedAt" = p_now
   WHERE "status" IN ('APPROVED','REJECTED','PENDING_APPROVAL') AND (("status" = 'APPROVED' AND "windowEndsAt" < p_now) OR ("status" = 'REJECTED') OR ("status" = 'PENDING_APPROVAL' AND "createdAt" < p_now - interval '14 days'));
  GET DIAGNOSTICS v_batches = ROW_COUNT;
  DELETE FROM "CorporateHrEntry" e USING "CorporateHrBatch" b WHERE e."batchId" = b."id" AND b."status" = 'PURGED';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('kx.growth_ledger_purge', 'on', true);
  DELETE FROM "CorporateBenefitEntry" l USING "CorporateAccount" a WHERE l."accountId" = a."id" AND a."status" = 'ENDED' AND a."endsAt" < (p_now - make_interval(years => p_ledger_years))
     AND NOT EXISTS (SELECT 1 FROM "CorporateBenefitEntry" n WHERE n."accountId" = a."id" AND n."createdAt" >= (p_now - make_interval(years => p_ledger_years)));
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  PERFORM set_config('kx.growth_ledger_purge', 'off', true);
  RETURN jsonb_build_object('corporateHrRowsPurged', v_rows, 'corporateHrBatchesPurged', v_batches, 'corporateLedgerEntriesPurged', v_ledger);
END $$;
