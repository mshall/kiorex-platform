-- GRW-P2-B1 / GRW-P2-B2 (wave 6, lane A1): the schema the referral engine and the patient rewards and credit ledger need on top of the X1 tables.
-- Additive and idempotent. No existing function or index is replaced (the erase function for the new tables is a NEW function, growth_erase_rewards_engine),
-- so this migration does not need to join the replay chain of growth-schema.int.spec.ts. Patient credit and provider credit stay two separate systems: nothing here references the Clinic wallet.

-- PaymentIntent: the credit (coupon or patient credit) applied to a deposit. `amountMinor` stays the CARD amount charged at the PSP (capture, webhook and PSP reconciliation are untouched);
-- `rewardMinor` is the part of the deposit paid with credit; `rewardPostedMinor` is the part of it that sits in the Pay ledger HELD account (REWARD_RULES.postToPayLedger, patient-refund credit always).
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "rewardMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "rewardPostedMinor" INTEGER NOT NULL DEFAULT 0;

-- RewardLot: a coupon code is sealed (AES-GCM) only until the patient has seen it once, then the seal is cleared and only the keyed hash stays (`couponCodeHash`).
ALTER TABLE "RewardLot" ADD COLUMN IF NOT EXISTS "couponCodeSealed" TEXT;
ALTER TABLE "RewardLot" ADD COLUMN IF NOT EXISTS "couponRevealedAt" TIMESTAMP(3);
ALTER TABLE "RewardLot" ADD COLUMN IF NOT EXISTS "issuedBy" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "RewardLot" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "RewardLot_couponCodeHash_key" ON "RewardLot"("couponCodeHash") WHERE "couponCodeHash" IS NOT NULL;

-- ReferralRelationship: when the hold window of a completed first visit ends, and the review state of a fraud hold.
ALTER TABLE "ReferralRelationship" ADD COLUMN IF NOT EXISTS "holdUntil" TIMESTAMP(3);
ALTER TABLE "ReferralRelationship" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "ReferralRelationship" ADD COLUMN IF NOT EXISTS "reviewState" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ReferralRelationship" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "ReferralRelationship" ADD COLUMN IF NOT EXISTS "claimedVia" TEXT NOT NULL DEFAULT 'LINK';
CREATE INDEX IF NOT EXISTS "ReferralRelationship_status_holdUntil_idx" ON "ReferralRelationship"("status", "holdUntil");

-- A share of an invite (counts only: no recipient, no contact).
CREATE TABLE IF NOT EXISTS "ReferralShare" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "codeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralShare_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ReferralShare_codeId_createdAt_idx" ON "ReferralShare"("codeId", "createdAt");

-- Manual issuance and goodwill above the approval threshold wait here for a second person (maker-checker). A decided request never changes again.
CREATE TABLE IF NOT EXISTS "RewardApprovalRequest" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sub" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "bookingId" TEXT,
    "ticketRef" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "lotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "RewardApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RewardApprovalRequest_status_createdAt_idx" ON "RewardApprovalRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardApprovalRequest_sub_idx" ON "RewardApprovalRequest"("sub");

-- Value a reversal could not take back (the reward was already spent): blocks further issuance to the subject for a while (REWARD_RULES, 90 days) and shows in the finance report.
CREATE TABLE IF NOT EXISTS "RewardRecoverableLoss" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sub" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardRecoverableLoss_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RewardRecoverableLoss_sub_createdAt_idx" ON "RewardRecoverableLoss"("sub", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RewardRecoverableLoss_lotId_bookingId_key" ON "RewardRecoverableLoss"("lotId", "bookingId");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('PaymentIntent', 'PaymentIntent_reward_check', '"rewardMinor" >= 0 AND "rewardPostedMinor" >= 0 AND "rewardPostedMinor" <= "rewardMinor"'),
    ('ReferralRelationship', 'ReferralRelationship_review_state_check', '"reviewState" IN (''NONE'',''HOLD'',''RELEASED'',''REJECTED'')'),
    ('ReferralRelationship', 'ReferralRelationship_claimed_via_check', '"claimedVia" IN (''LINK'',''SIGNUP'',''APP'')'),
    ('ReferralShare', 'ReferralShare_channel_check', '"channel" IN (''LINK'',''WHATSAPP_SHARE'',''SMS'',''COPY'')'),
    ('RewardApprovalRequest', 'RewardApprovalRequest_kind_check', '"kind" IN (''MANUAL_ISSUE'',''GOODWILL'')'),
    ('RewardApprovalRequest', 'RewardApprovalRequest_status_check', '"status" IN (''PENDING'',''APPROVED'',''REJECTED'')'),
    ('RewardApprovalRequest', 'RewardApprovalRequest_amount_check', '"amountMinor" > 0'),
    ('RewardApprovalRequest', 'RewardApprovalRequest_maker_checker_check', '"decidedBy" IS NULL OR "decidedBy" <> "requestedBy"'),
    ('RewardApprovalRequest', 'RewardApprovalRequest_decided_check', '("status" = ''PENDING'') = ("decidedBy" IS NULL)'),
    ('RewardRecoverableLoss', 'RewardRecoverableLoss_amount_check', '"amountMinor" > 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- A RESTORED lot (value given back after a refund of a booking paid with credit) keeps the funding label of the lot it came from, including the patient's own refunded money.
-- The 096000 check tied the label to the kind in both directions; REFUND_CREDIT still implies PATIENT_REFUND, and PATIENT_REFUND is only for REFUND_CREDIT and RESTORED lots.
ALTER TABLE "RewardLot" DROP CONSTRAINT IF EXISTS "RewardLot_refund_credit_funding_check";
ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_refund_credit_funding_check" CHECK (("kind" <> 'REFUND_CREDIT' OR "funding" = 'PATIENT_REFUND') AND ("funding" <> 'PATIENT_REFUND' OR "kind" IN ('REFUND_CREDIT', 'RESTORED')));

-- A decided approval request is immutable (the maintenance function may anonymise it).
CREATE OR REPLACE FUNCTION reward_approval_decided_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('kx.growth_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'RewardApprovalRequest cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'RewardApprovalRequest % is already decided', OLD."id" USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reward_approval_decided ON "RewardApprovalRequest";
CREATE TRIGGER reward_approval_decided BEFORE UPDATE OR DELETE ON "RewardApprovalRequest" FOR EACH ROW EXECUTE FUNCTION reward_approval_decided_guard();

DROP TRIGGER IF EXISTS reward_recoverable_loss_immutable ON "RewardRecoverableLoss";
CREATE TRIGGER reward_recoverable_loss_immutable BEFORE UPDATE OR DELETE ON "RewardRecoverableLoss" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only_maint();

-- S1/S3 in the database: a reservation can only be made on a lot that is still inside its expiry. (A held lot has no available balance, so the balance trigger already refuses it.)
CREATE OR REPLACE FUNCTION reward_reserve_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record;
BEGIN
  IF NEW."type" <> 'RESERVE' THEN RETURN NEW; END IF;
  SELECT "expiresAt", "status" INTO l FROM "RewardLot" WHERE "id" = NEW."lotId";
  IF l."expiresAt" <= timezone('UTC', now()) THEN RAISE EXCEPTION 'reward lot % is expired and cannot be reserved', NEW."lotId" USING ERRCODE = '23514'; END IF;
  IF l."status" IN ('HELD', 'EXPIRED', 'REVERSED') THEN RAISE EXCEPTION 'reward lot % is % and cannot be reserved', NEW."lotId", l."status" USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reward_reserve_guard ON "RewardLedgerEntry";
CREATE TRIGGER reward_reserve_guard BEFORE INSERT ON "RewardLedgerEntry" FOR EACH ROW EXECUTE FUNCTION reward_reserve_guard();

-- Subject erasure for the tables above. growth_erase_subject (migration 096000) is not touched: GrowthMaintenanceService.eraseSubject calls this function right after it.
-- Approval requests and recoverable losses keep their amounts (accounting) and lose the person; nothing else of this migration holds a subject.
CREATE OR REPLACE FUNCTION growth_erase_rewards_engine(p_sub text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_hash text; v_req int := 0; v_loss int := 0;
BEGIN
  IF p_sub IS NULL OR length(btrim(p_sub)) = 0 THEN
    RAISE EXCEPTION 'growth_erase_rewards_engine: sub is required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('kx.growth_maintenance', 'on', true);
  v_hash := 'h:' || encode(sha256(convert_to(p_sub, 'UTF8')), 'hex');
  UPDATE "RewardApprovalRequest" SET "sub" = v_hash, "payload" = '{}'::jsonb, "ticketRef" = NULL WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_req = ROW_COUNT;
  UPDATE "RewardRecoverableLoss" SET "sub" = v_hash WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_loss = ROW_COUNT;
  UPDATE "RewardLot" SET "couponCodeSealed" = NULL WHERE "sub" = v_hash AND "couponCodeSealed" IS NOT NULL;
  PERFORM set_config('kx.growth_maintenance', 'off', true);
  RETURN jsonb_build_object('rewardApprovalRequestsAnonymised', v_req, 'recoverableLossesAnonymised', v_loss);
END $$;
