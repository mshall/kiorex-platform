-- GRW-P2-X1 (wave 5): referral and reward tables. Rewards are an append-only ledger (trigger) with a race-proof balance constraint.
-- Rewards never touch attribution or commission: nothing here references GrowthAttributionDecision.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralCode" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sub" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralRelationship" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "referrerSub" TEXT NOT NULL,
    "refereeSub" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "touchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "rejectReason" TEXT,
    "firstBookingId" TEXT,
    "qualifiedBookingId" TEXT,
    "ruleVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralQualificationCheck" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralQualificationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralIdentitySignal" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralIdentitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardLot" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "amountMinor" INTEGER NOT NULL,
    "couponCodeHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ruleVersionId" TEXT NOT NULL,
    "relationshipId" TEXT,
    "campaignId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardLedgerEntry" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "idempotencyKey" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "bookingId" TEXT,
    "payLinkId" TEXT,
    "relationshipId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RewardIssuanceBudget" (
    "ruleVersionId" TEXT NOT NULL,
    "issuedMinor" INTEGER NOT NULL DEFAULT 0,
    "ceilingMinor" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardIssuanceBudget_pkey" PRIMARY KEY ("ruleVersionId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_market_sub_key" ON "ReferralCode"("market", "sub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralRelationship_referrerSub_createdAt_idx" ON "ReferralRelationship"("referrerSub", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralRelationship_status_createdAt_idx" ON "ReferralRelationship"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralRelationship_market_refereeSub_key" ON "ReferralRelationship"("market", "refereeSub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralQualificationCheck_relationshipId_at_idx" ON "ReferralQualificationCheck"("relationshipId", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralIdentitySignal_sub_idx" ON "ReferralIdentitySignal"("sub");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralIdentitySignal_kind_valueHash_sub_key" ON "ReferralIdentitySignal"("kind", "valueHash", "sub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLot_sub_status_idx" ON "RewardLot"("sub", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLot_expiresAt_status_idx" ON "RewardLot"("expiresAt", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLot_relationshipId_idx" ON "RewardLot"("relationshipId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLot_campaignId_idx" ON "RewardLot"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key" ON "RewardLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_lotId_createdAt_idx" ON "RewardLedgerEntry"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_bookingId_idx" ON "RewardLedgerEntry"("bookingId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralRelationship_codeId_fkey') THEN
    ALTER TABLE "ReferralRelationship" ADD CONSTRAINT "ReferralRelationship_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralQualificationCheck_relationshipId_fkey') THEN
    ALTER TABLE "ReferralQualificationCheck" ADD CONSTRAINT "ReferralQualificationCheck_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ReferralRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RewardLedgerEntry_lotId_fkey') THEN
    ALTER TABLE "RewardLedgerEntry" ADD CONSTRAINT "RewardLedgerEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RewardLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('ReferralCode', 'ReferralCode_format_check', '"code" ~ ''^[0-9A-HJKMNP-TV-Z]{8}$'''),
    ('ReferralCode', 'ReferralCode_status_check', '"status" IN (''ACTIVE'',''SUSPENDED'')'),
    ('ReferralRelationship', 'ReferralRelationship_status_check', '"status" IN (''INVITED'',''SIGNED_UP'',''BOOKED'',''QUALIFIED'',''REJECTED'',''EXPIRED'')'),
    ('ReferralRelationship', 'ReferralRelationship_not_self_check', '"referrerSub" <> "refereeSub"'),
    ('ReferralIdentitySignal', 'ReferralIdentitySignal_kind_check', '"kind" IN (''PHONE'',''PAY_FINGERPRINT'',''DEVICE'',''IP24'')'),
    ('RewardLot', 'RewardLot_kind_check', '"kind" IN (''REFERRER'',''REFEREE'',''REPEAT'',''PROMO'',''CORPORATE'',''LOYALTY'')'),
    ('RewardLot', 'RewardLot_mode_check', '"mode" IN (''CREDIT'',''COUPON'')'),
    ('RewardLot', 'RewardLot_status_check', '"status" IN (''ACTIVE'',''HELD'',''EXHAUSTED'',''EXPIRED'',''REVERSED'')'),
    ('RewardLot', 'RewardLot_amount_check', '"amountMinor" > 0'),
    ('RewardLedgerEntry', 'RewardLedgerEntry_type_check', '"type" IN (''ISSUE'',''HOLD'',''RELEASE_HOLD'',''RESERVE'',''UNRESERVE'',''REDEEM'',''REVERSE'',''EXPIRE'')'),
    ('RewardLedgerEntry', 'RewardLedgerEntry_amount_check', '"amountMinor" > 0'),
    ('RewardLedgerEntry', 'RewardLedgerEntry_key_check', '"idempotencyKey" ~ ''^rwd:[a-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,64}$'''),
    ('RewardIssuanceBudget', 'RewardIssuanceBudget_bounds_check', '"issuedMinor" >= 0 AND "ceilingMinor" >= 0 AND "issuedMinor" <= "ceilingMinor"')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS referral_qualification_check_immutable ON "ReferralQualificationCheck";
CREATE TRIGGER referral_qualification_check_immutable BEFORE UPDATE OR DELETE ON "ReferralQualificationCheck" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only_maint();

-- Reward ledger: append-only. Only growth_purge_expired_v2 may delete rows past the accounting retention (kx.growth_ledger_purge = on, set inside that SECURITY DEFINER function).
CREATE OR REPLACE FUNCTION reward_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('kx.growth_ledger_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'RewardLedgerEntry is append-only: % is not allowed (append a REVERSE or EXPIRE entry)', TG_OP USING ERRCODE = '55000';
END $$;
DROP TRIGGER IF EXISTS reward_ledger_immutable ON "RewardLedgerEntry";
CREATE TRIGGER reward_ledger_immutable BEFORE UPDATE OR DELETE ON "RewardLedgerEntry" FOR EACH ROW EXECUTE FUNCTION reward_ledger_guard();

-- Balances of one lot, computed from the ledger (the lot `status` column is only a cache).
--   available = ISSUE + RELEASE_HOLD + UNRESERVE - HOLD - RESERVE - EXPIRE - REVERSE
--   held      = HOLD - RELEASE_HOLD
--   reserved  = RESERVE - UNRESERVE - REDEEM          (a REDEEM always consumes a RESERVE made earlier for the same payment)
CREATE OR REPLACE FUNCTION reward_lot_balance(p_lot text) RETURNS TABLE (available bigint, held bigint, reserved bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(CASE "type" WHEN 'ISSUE' THEN "amountMinor" WHEN 'RELEASE_HOLD' THEN "amountMinor" WHEN 'UNRESERVE' THEN "amountMinor"
                             WHEN 'HOLD' THEN -"amountMinor" WHEN 'RESERVE' THEN -"amountMinor" WHEN 'EXPIRE' THEN -"amountMinor" WHEN 'REVERSE' THEN -"amountMinor" ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE "type" WHEN 'HOLD' THEN "amountMinor" WHEN 'RELEASE_HOLD' THEN -"amountMinor" ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'UNRESERVE' THEN -"amountMinor" WHEN 'REDEEM' THEN -"amountMinor" ELSE 0 END), 0)::bigint
  FROM "RewardLedgerEntry" WHERE "lotId" = p_lot
$$;

-- Race-proof: a deferred constraint trigger takes FOR UPDATE on the lot row, THEN recomputes the balances (READ COMMITTED sees every entry committed while it waited),
-- and refuses a transaction that would leave available, held or reserved negative. 20 parallel redeems of one lot can never spend more than it holds.
CREATE OR REPLACE FUNCTION reward_ledger_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  PERFORM 1 FROM "RewardLot" WHERE "id" = NEW."lotId" FOR UPDATE;
  SELECT * INTO b FROM reward_lot_balance(NEW."lotId");
  IF b.available < 0 OR b.held < 0 OR b.reserved < 0 THEN
    RAISE EXCEPTION 'reward lot % would have a negative balance (available %, held %, reserved %)', NEW."lotId", b.available, b.held, b.reserved USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reward_ledger_balance ON "RewardLedgerEntry";
CREATE CONSTRAINT TRIGGER reward_ledger_balance AFTER INSERT ON "RewardLedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reward_ledger_balance_guard();
