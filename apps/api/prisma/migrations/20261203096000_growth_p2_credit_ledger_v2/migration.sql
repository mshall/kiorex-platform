-- GRW-P2-X1 (wave 5, Rev 2.6 credit amendment): the PATIENT credit system tables and rules (ADR-048 Proposed; two separate credit systems: nothing here references the provider wallet).
-- Idempotent. RewardLot gains owner, household, funding, scope and the verified qualifying visit; RewardLedgerEntry gains refundId; new tables for households, refund destination choices,
-- goodwill grants, checkout snapshots and reconciliation runs. Safety rules S3, S4 and S7 are database constraints. growth_erase_subject and growth_purge_expired_v2 are replaced again to cover the new tables.

-- AlterTable
ALTER TABLE "RewardLot" ADD COLUMN IF NOT EXISTS "funding" TEXT NOT NULL DEFAULT 'PLATFORM_MARKETING',
ADD COLUMN IF NOT EXISTS "householdId" TEXT,
ADD COLUMN IF NOT EXISTS "ownerSub" TEXT,
ADD COLUMN IF NOT EXISTS "qualifyingBookingId" TEXT,
ADD COLUMN IF NOT EXISTS "scope" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "RewardLedgerEntry" ADD COLUMN IF NOT EXISTS "refundId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardHousehold" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "ownerSub" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardHousehold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardHouseholdMember" (
    "householdId" TEXT NOT NULL,
    "memberSub" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'DEPENDANT',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "RewardHouseholdMember_pkey" PRIMARY KEY ("householdId","memberSub")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RefundDestinationChoice" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "refundId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "chosenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "RefundDestinationChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoodwillGrant" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sub" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "bookingId" TEXT,
    "ticketRef" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "lotId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodwillGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardCheckoutLine" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sub" TEXT NOT NULL,
    "bookingId" TEXT,
    "payLinkId" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardCheckoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardReconcileRun" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "results" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "caseRef" TEXT,

    CONSTRAINT "RewardReconcileRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RewardHousehold_market_ownerSub_key" ON "RewardHousehold"("market", "ownerSub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardHouseholdMember_memberSub_idx" ON "RewardHouseholdMember"("memberSub");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RefundDestinationChoice_refundId_key" ON "RefundDestinationChoice"("refundId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefundDestinationChoice_sub_idx" ON "RefundDestinationChoice"("sub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefundDestinationChoice_bookingId_idx" ON "RefundDestinationChoice"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoodwillGrant_sub_createdAt_idx" ON "GoodwillGrant"("sub", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoodwillGrant_grantedBy_createdAt_idx" ON "GoodwillGrant"("grantedBy", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardCheckoutLine_bookingId_idx" ON "RewardCheckoutLine"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardCheckoutLine_sub_idx" ON "RewardCheckoutLine"("sub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardReconcileRun_ranAt_idx" ON "RewardReconcileRun"("ranAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLot_ownerSub_idx" ON "RewardLot"("ownerSub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLot_householdId_idx" ON "RewardLot"("householdId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_refundId_idx" ON "RewardLedgerEntry"("refundId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RewardHouseholdMember_householdId_fkey') THEN
    ALTER TABLE "RewardHouseholdMember" ADD CONSTRAINT "RewardHouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "RewardHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- S3 every grant has an expiry; the kinds list grows; funding is one of three labels. The old kind CHECK (migration 091000) is replaced, never edited.
ALTER TABLE "RewardLot" DROP CONSTRAINT IF EXISTS "RewardLot_kind_check";
ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_kind_check" CHECK ("kind" IN ('REFERRER','REFEREE','REPEAT','PROMO','CORPORATE','LOYALTY','WELCOME','GOODWILL','CAMPAIGN','REFUND_CREDIT','RESTORED'));
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('RewardLot', 'RewardLot_expiry_required_check', '"expiresAt" IS NOT NULL'),
    ('RewardLot', 'RewardLot_funding_check', '"funding" IN (''PLATFORM_MARKETING'',''PLATFORM_SERVICE_RECOVERY'',''PATIENT_REFUND'')'),
    ('RewardLot', 'RewardLot_refund_credit_funding_check', '("kind" = ''REFUND_CREDIT'') = ("funding" = ''PATIENT_REFUND'')'),
    ('RewardHouseholdMember', 'RewardHouseholdMember_relation_check', '"relation" IN (''DEPENDANT'')'),
    ('RefundDestinationChoice', 'RefundDestinationChoice_choice_check', '"choice" IN (''ORIGINAL'',''CREDIT'')'),
    ('RefundDestinationChoice', 'RefundDestinationChoice_source_check', '"source" IN (''PATIENT_CANCEL'',''PATIENT_REFUND_REQUEST'')'),
    ('GoodwillGrant', 'GoodwillGrant_reason_check', '"reason" IN (''PROVIDER_LATE_CANCEL'',''LONG_WAIT'',''FAILED_BOOKING'',''PAYMENT_ISSUE'',''OTHER_APPROVED'')'),
    ('GoodwillGrant', 'GoodwillGrant_amount_check', '"amountMinor" > 0'),
    ('GoodwillGrant', 'GoodwillGrant_maker_checker_check', '"approvedBy" IS NULL OR "approvedBy" <> "grantedBy"'),
    ('GoodwillGrant', 'GoodwillGrant_reference_check', '"bookingId" IS NOT NULL OR "ticketRef" IS NOT NULL'),
    ('RewardCheckoutLine', 'RewardCheckoutLine_price_check', '"priceMinor" > 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
-- The refund choice and the checkout snapshot are immutable (the maintenance functions may anonymise or purge them).
DROP TRIGGER IF EXISTS refund_destination_choice_immutable ON "RefundDestinationChoice";
CREATE TRIGGER refund_destination_choice_immutable BEFORE UPDATE OR DELETE ON "RefundDestinationChoice" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only_maint();
DROP TRIGGER IF EXISTS reward_checkout_line_immutable ON "RewardCheckoutLine";
CREATE TRIGGER reward_checkout_line_immutable BEFORE UPDATE OR DELETE ON "RewardCheckoutLine" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only_maint();

-- S4 issuance only on a verified qualifying event: an ISSUE on a REFERRER, REFEREE, WELCOME or CAMPAIGN lot needs a qualifying booking that Kiorex has COMPLETED. Sign-up and an
-- unfinished booking can never issue value. S7 no top-up: the only ISSUE linked to a payment path is a REFUND_CREDIT with a refundId and a recorded CREDIT choice for that refund.
CREATE OR REPLACE FUNCTION reward_issue_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record;
BEGIN
  IF NEW."type" <> 'ISSUE' THEN RETURN NEW; END IF;
  SELECT "kind", "qualifyingBookingId" INTO l FROM "RewardLot" WHERE "id" = NEW."lotId";
  IF l."kind" IN ('REFERRER', 'REFEREE', 'WELCOME', 'CAMPAIGN') THEN
    IF l."qualifyingBookingId" IS NULL OR NOT EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."id" = l."qualifyingBookingId" AND b."status" = 'COMPLETED') THEN
      RAISE EXCEPTION 'reward lot % (%) can only be issued for a COMPLETED qualifying booking', NEW."lotId", l."kind" USING ERRCODE = '23514';
    END IF;
  END IF;
  IF l."kind" = 'REFUND_CREDIT' THEN
    IF NEW."refundId" IS NULL OR NOT EXISTS (SELECT 1 FROM "RefundDestinationChoice" c WHERE c."refundId" = NEW."refundId" AND c."choice" = 'CREDIT') THEN
      RAISE EXCEPTION 'a REFUND_CREDIT issue needs a refund with a recorded CREDIT choice' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."refundId" IS NOT NULL AND l."kind" <> 'RESTORED' THEN
    RAISE EXCEPTION 'only a REFUND_CREDIT or RESTORED lot may be issued against a refund' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reward_issue_guard ON "RewardLedgerEntry";
CREATE TRIGGER reward_issue_guard BEFORE INSERT ON "RewardLedgerEntry" FOR EACH ROW EXECUTE FUNCTION reward_issue_guard();

CREATE OR REPLACE FUNCTION growth_erase_subject(p_sub text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_keys text[];
  v_anonymised int := 0;
  v_deleted int := 0;
  v_events int := 0;
  v_hash text;
  v_hh int := 0; v_hm int := 0; v_rdc int := 0; v_gw int := 0; v_cl int := 0; v_ref int := 0; v_code int := 0; v_signals int := 0; v_lots int := 0; v_life int := 0; v_enrol int := 0; v_dec int := 0; v_sessions int := 0;
  v_result jsonb;
BEGIN
  IF p_sub IS NULL OR length(btrim(p_sub)) = 0 THEN
    RAISE EXCEPTION 'growth_erase_subject: sub is required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('kx.growth_maintenance', 'on', true);
  v_hash := 'h:' || encode(sha256(convert_to(p_sub, 'UTF8')), 'hex');

  SELECT coalesce(array_agg(DISTINCT "visitorKey"), ARRAY[]::text[]) INTO v_keys
    FROM "GrowthTouchpoint" WHERE "sub" = p_sub AND "visitorKey" IS NOT NULL;

  WITH cited AS (
    SELECT unnest("evidenceTouchIds") AS id FROM "GrowthAttributionDecision"
    UNION SELECT "firstTouchId" FROM "GrowthAttributionDecision" WHERE "firstTouchId" IS NOT NULL
    UNION SELECT "lastTouchId" FROM "GrowthAttributionDecision" WHERE "lastTouchId" IS NOT NULL
    UNION SELECT "lastNonDirectTouchId" FROM "GrowthAttributionDecision" WHERE "lastNonDirectTouchId" IS NOT NULL
  )
  UPDATE "GrowthTouchpoint" SET "sub" = NULL, "visitorKey" = NULL, "ipHash" = '', "clickIdHash" = NULL, "ltTokenId" = NULL
   WHERE ("sub" = p_sub OR "visitorKey" = ANY (v_keys)) AND "id" IN (SELECT id FROM cited);
  GET DIAGNOSTICS v_anonymised = ROW_COUNT;

  DELETE FROM "GrowthTouchpoint" WHERE "sub" = p_sub OR "visitorKey" = ANY (v_keys);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM "GrowthEvent" WHERE "visitorKey" = ANY (v_keys);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  -- ── Phase 2 ──
  -- Referral relationships stay (ledger and rule evidence) with both subs replaced by a one-way hash; codes are suspended and anonymised; identity signals are deleted.
  UPDATE "ReferralRelationship" SET "referrerSub" = v_hash WHERE "referrerSub" = p_sub;
  GET DIAGNOSTICS v_ref = ROW_COUNT;
  UPDATE "ReferralRelationship" SET "refereeSub" = v_hash WHERE "refereeSub" = p_sub;
  UPDATE "ReferralCode" SET "sub" = v_hash, "status" = 'SUSPENDED' WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_code = ROW_COUNT;
  DELETE FROM "ReferralIdentitySignal" WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_signals = ROW_COUNT;
  -- Reward lots keep their ledger rows (accounting) but lose the person: sub becomes the hash, the coupon hash is dropped.
  UPDATE "RewardLot" SET "sub" = v_hash, "couponCodeHash" = NULL WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_lots = ROW_COUNT;
  UPDATE "RewardLot" SET "ownerSub" = v_hash WHERE "ownerSub" = p_sub;
  -- Rev 2.6 patient credit: household, refund choices, goodwill grants and checkout snapshots keep their rows (the ledger needs them) but lose the person.
  UPDATE "RewardHousehold" SET "ownerSub" = v_hash WHERE "ownerSub" = p_sub;
  GET DIAGNOSTICS v_hh = ROW_COUNT;
  UPDATE "RewardHouseholdMember" SET "memberSub" = v_hash WHERE "memberSub" = p_sub;
  GET DIAGNOSTICS v_hm = ROW_COUNT;
  UPDATE "RefundDestinationChoice" SET "sub" = v_hash WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_rdc = ROW_COUNT;
  UPDATE "GoodwillGrant" SET "sub" = v_hash WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_gw = ROW_COUNT;
  UPDATE "RewardCheckoutLine" SET "sub" = v_hash WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_cl = ROW_COUNT;
  DELETE FROM "PatientLifecycle" WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_life = ROW_COUNT;
  DELETE FROM "LifecycleEnrollment" WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_enrol = ROW_COUNT;
  UPDATE "LifecycleMessageDecision" SET "sub" = v_hash WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_dec = ROW_COUNT;
  DELETE FROM "AssistantSession" WHERE "sub" = p_sub; -- turns, tool calls and escalations go with it (ON DELETE CASCADE)
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  PERFORM set_config('kx.growth_maintenance', 'off', true);
  v_result := jsonb_build_object('touchpointsDeleted', v_deleted, 'touchpointsAnonymised', v_anonymised, 'eventsDeleted', v_events, 'visitorKeys', cardinality(v_keys),
    'referralRelationshipsAnonymised', v_ref, 'referralCodesAnonymised', v_code, 'identitySignalsDeleted', v_signals, 'rewardLotsAnonymised', v_lots,
    'householdsAnonymised', v_hh, 'householdMembersAnonymised', v_hm, 'refundChoicesAnonymised', v_rdc, 'goodwillGrantsAnonymised', v_gw, 'checkoutLinesAnonymised', v_cl,
    'lifecycleRowsDeleted', v_life, 'enrollmentsDeleted', v_enrol, 'messageDecisionsAnonymised', v_dec, 'assistantSessionsDeleted', v_sessions);
  INSERT INTO "AuditLog" ("id", "actor", "action", "resource", "resourceId", "metadata")
  VALUES (gen_random_uuid()::text, 'system:growth', 'growth.erase_subject', 'GrowthSubject', encode(sha256(convert_to(p_sub, 'UTF8')), 'hex'), v_result);
  RETURN v_result;
END $$;


CREATE OR REPLACE FUNCTION growth_purge_expired_v2(
  p_now timestamptz DEFAULT now(), p_linked_months int DEFAULT 25, p_unlinked_months int DEFAULT 13,
  p_toolcall_months int DEFAULT 12, p_lifecycle_decision_months int DEFAULT 24, p_ledger_years int DEFAULT 7, p_qualification_months int DEFAULT 24, p_jobrun_months int DEFAULT 13
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_base jsonb; v_turns int := 0; v_tools int := 0; v_sessions int := 0; v_dec int := 0; v_ledger int := 0; v_lots int := 0; v_checks int := 0; v_jobs int := 0; v_rdc int := 0; v_gw int := 0; v_cl int := 0; v_result jsonb;
BEGIN
  IF p_toolcall_months < 1 OR p_lifecycle_decision_months < 1 OR p_ledger_years < 1 OR p_qualification_months < 1 OR p_jobrun_months < 1 THEN
    RAISE EXCEPTION 'growth_purge_expired_v2: retention values must be >= 1' USING ERRCODE = '22023';
  END IF;
  v_base := growth_purge_expired(p_now, p_linked_months, p_unlinked_months);
  PERFORM set_config('kx.growth_maintenance', 'on', true);

  -- tool-call audit first (12 months): a turn delete would cascade to its tool calls and hide them from the count
  DELETE FROM "AssistantToolCall" WHERE "createdAt" < (p_now - make_interval(months => p_toolcall_months));
  GET DIAGNOSTICS v_tools = ROW_COUNT;
  DELETE FROM "AssistantTurn" WHERE "purgeAfter" < p_now;
  GET DIAGNOSTICS v_turns = ROW_COUNT;
  DELETE FROM "AssistantSession" s WHERE s."expiresAt" < p_now AND NOT EXISTS (SELECT 1 FROM "AssistantTurn" t WHERE t."sessionId" = s."id");
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  DELETE FROM "LifecycleMessageDecision" WHERE "at" < (p_now - make_interval(months => p_lifecycle_decision_months));
  GET DIAGNOSTICS v_dec = ROW_COUNT;
  DELETE FROM "ReferralQualificationCheck" WHERE "at" < (p_now - make_interval(months => p_qualification_months));
  GET DIAGNOSTICS v_checks = ROW_COUNT;
  DELETE FROM "GrowthJobRun" WHERE "startedAt" < (p_now - make_interval(months => p_jobrun_months));
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  -- Reward ledger: only lots whose whole history is older than the accounting retention and that can no longer move value (EXHAUSTED, EXPIRED or REVERSED).
  PERFORM set_config('kx.growth_ledger_purge', 'on', true);
  DELETE FROM "RewardLedgerEntry" e USING "RewardLot" l
   WHERE e."lotId" = l."id" AND l."status" IN ('EXHAUSTED', 'EXPIRED', 'REVERSED') AND l."expiresAt" < (p_now - make_interval(years => p_ledger_years))
     AND NOT EXISTS (SELECT 1 FROM "RewardLedgerEntry" n WHERE n."lotId" = l."id" AND n."createdAt" >= (p_now - make_interval(years => p_ledger_years)));
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  PERFORM set_config('kx.growth_ledger_purge', 'off', true);
  DELETE FROM "RewardLot" l WHERE l."status" IN ('EXHAUSTED', 'EXPIRED', 'REVERSED') AND l."expiresAt" < (p_now - make_interval(years => p_ledger_years)) AND NOT EXISTS (SELECT 1 FROM "RewardLedgerEntry" e WHERE e."lotId" = l."id");
  GET DIAGNOSTICS v_lots = ROW_COUNT;

  -- Rev 2.6: refund choices, goodwill grants and checkout snapshots follow the ledger retention.
  DELETE FROM "RefundDestinationChoice" WHERE "chosenAt" < (p_now - make_interval(years => p_ledger_years));
  GET DIAGNOSTICS v_rdc = ROW_COUNT;
  DELETE FROM "GoodwillGrant" WHERE "createdAt" < (p_now - make_interval(years => p_ledger_years));
  GET DIAGNOSTICS v_gw = ROW_COUNT;
  DELETE FROM "RewardCheckoutLine" WHERE "createdAt" < (p_now - make_interval(years => p_ledger_years));
  GET DIAGNOSTICS v_cl = ROW_COUNT;

  PERFORM set_config('kx.growth_maintenance', 'off', true);
  v_result := v_base || jsonb_build_object('assistantTurnsDeleted', v_turns, 'assistantToolCallsDeleted', v_tools, 'assistantSessionsDeleted', v_sessions, 'lifecycleDecisionsDeleted', v_dec,
    'rewardLedgerEntriesDeleted', v_ledger, 'rewardLotsDeleted', v_lots, 'qualificationChecksDeleted', v_checks, 'jobRunsDeleted', v_jobs, 'refundChoicesDeleted', v_rdc, 'goodwillGrantsDeleted', v_gw, 'checkoutLinesDeleted', v_cl);
  INSERT INTO "AuditLog" ("id", "actor", "action", "resource", "resourceId", "metadata")
  VALUES (gen_random_uuid()::text, 'system:growth', 'growth.purge_expired_v2', 'GrowthRetention', NULL, v_result);
  RETURN v_result;
END $$;
