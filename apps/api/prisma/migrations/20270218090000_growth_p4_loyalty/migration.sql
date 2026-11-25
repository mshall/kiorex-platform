-- GRW-P4-D loyalty points and partnership programs (Kiorex side).
-- A SEPARATE points ledger (LoyaltyAccrualEntry, append-only, FIFO expiry, balance never negative by trigger) and partnership programs linked to a GrowthCampaign on the PARTNER channel (approval through the
-- campaign path, budget cap enforced by trigger). Points are NOT money: nothing here is a top-up, transfer, gift or cash-out, and no foreign key points into a credit table. Points leave the ledger by one
-- route only: a CONVERT entry that names a RewardLot of kind LOYALTY written in the same transaction by the application (the trigger checks the lot).
-- Idempotent: every statement can be replayed (IF NOT EXISTS, guarded constraints, OR REPLACE functions, DROP IF EXISTS before CREATE TRIGGER).
-- Non-Prisma objects below (documented for the schema drift check): CHECK constraints, the ledger and program guard triggers, the append-only triggers, the FIFO expiry function and the erase function.

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "tier" TEXT NOT NULL DEFAULT 'NONE',
    "tierSince" TIMESTAMP(3),
    "pointsBalanceCache" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoyaltyAccrualEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "bookingId" TEXT,
    "lotId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "shortfallPoints" INTEGER NOT NULL DEFAULT 0,
    "reasonCode" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyAccrualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PartnershipProgram" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "key" TEXT NOT NULL,
    "partnerRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "fundingMode" TEXT NOT NULL DEFAULT 'PLATFORM_MARKETING',
    "budgetMinor" INTEGER NOT NULL DEFAULT 0,
    "perRedemptionMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "campaignId" TEXT,
    "legalTextRef" TEXT,
    "createdBy" TEXT NOT NULL,
    "activatedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PartnershipCode" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "maxRedemptions" INTEGER NOT NULL,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PartnershipCodeRedemption" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "subHash" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipCodeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyAccount_market_tier_idx" ON "LoyaltyAccount"("market", "tier");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyAccount_market_sub_key" ON "LoyaltyAccount"("market", "sub");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyAccrualEntry_idempotencyKey_key" ON "LoyaltyAccrualEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyAccrualEntry_accountId_createdAt_idx" ON "LoyaltyAccrualEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyAccrualEntry_bookingId_idx" ON "LoyaltyAccrualEntry"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoyaltyAccrualEntry_type_createdAt_idx" ON "LoyaltyAccrualEntry"("type", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PartnershipProgram_status_endsAt_idx" ON "PartnershipProgram"("status", "endsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PartnershipProgram_campaignId_idx" ON "PartnershipProgram"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PartnershipProgram_market_key_key" ON "PartnershipProgram"("market", "key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PartnershipCode_codeHash_key" ON "PartnershipCode"("codeHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PartnershipCode_programId_status_idx" ON "PartnershipCode"("programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PartnershipCodeRedemption_lotId_key" ON "PartnershipCodeRedemption"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PartnershipCodeRedemption_idempotencyKey_key" ON "PartnershipCodeRedemption"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PartnershipCodeRedemption_programId_createdAt_idx" ON "PartnershipCodeRedemption"("programId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PartnershipCodeRedemption_programId_subHash_key" ON "PartnershipCodeRedemption"("programId", "subHash");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyAccrualEntry_accountId_fkey') THEN ALTER TABLE "LoyaltyAccrualEntry" ADD CONSTRAINT "LoyaltyAccrualEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartnershipProgram_campaignId_fkey') THEN ALTER TABLE "PartnershipProgram" ADD CONSTRAINT "PartnershipProgram_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartnershipCode_programId_fkey') THEN ALTER TABLE "PartnershipCode" ADD CONSTRAINT "PartnershipCode_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PartnershipProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartnershipCodeRedemption_programId_fkey') THEN ALTER TABLE "PartnershipCodeRedemption" ADD CONSTRAINT "PartnershipCodeRedemption_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PartnershipProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;


-- ── constraints that Prisma cannot express ──
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('LoyaltyAccount', 'LoyaltyAccount_tier_check', '"tier" IN (''NONE'',''SILVER'',''GOLD'',''PLATINUM'')'),
    ('LoyaltyAccount', 'LoyaltyAccount_balance_check', '"pointsBalanceCache" >= 0'),
    ('LoyaltyAccrualEntry', 'LoyaltyAccrualEntry_type_check', '"type" IN (''ACCRUE'',''EXPIRE'',''REVERSE'',''TIER_BONUS'',''CONVERT'')'),
    ('LoyaltyAccrualEntry', 'LoyaltyAccrualEntry_points_check', '"points" > 0 AND "shortfallPoints" >= 0'),
    ('LoyaltyAccrualEntry', 'LoyaltyAccrualEntry_expiry_check', '(("type" IN (''ACCRUE'',''TIER_BONUS'')) = ("expiresAt" IS NOT NULL))'),
    ('LoyaltyAccrualEntry', 'LoyaltyAccrualEntry_convert_lot_check', '(("type" = ''CONVERT'') = ("lotId" IS NOT NULL))'),
    ('LoyaltyAccrualEntry', 'LoyaltyAccrualEntry_accrue_booking_check', '("type" <> ''ACCRUE'' OR "bookingId" IS NOT NULL)'),
    ('PartnershipProgram', 'PartnershipProgram_kind_check', '"kind" IN (''CODE_DISCOUNT'',''CO_PROMO'',''CARD_OFFER'')'),
    ('PartnershipProgram', 'PartnershipProgram_status_check', '"status" IN (''DRAFT'',''ACTIVE'',''PAUSED'',''ENDED'')'),
    ('PartnershipProgram', 'PartnershipProgram_funding_check', '"fundingMode" IN (''PLATFORM_MARKETING'',''PARTNER_FUNDED'')'),
    ('PartnershipProgram', 'PartnershipProgram_amounts_check', '"budgetMinor" >= 0 AND "perRedemptionMinor" >= 0 AND ("perRedemptionMinor" = 0 OR "perRedemptionMinor" <= "budgetMinor")'),
    ('PartnershipProgram', 'PartnershipProgram_window_check', '("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt")'),
    -- ACTIVE needs a budget, a per-redemption value, a window, the linked campaign, a legal text reference, platform funding and a second person (the activator is not the creator)
    ('PartnershipProgram', 'PartnershipProgram_active_check', '("status" NOT IN (''ACTIVE'',''PAUSED'') OR ("budgetMinor" > 0 AND "perRedemptionMinor" > 0 AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "campaignId" IS NOT NULL AND "legalTextRef" IS NOT NULL AND length(btrim("legalTextRef")) > 0 AND "fundingMode" = ''PLATFORM_MARKETING'' AND "activatedBy" IS NOT NULL AND "activatedBy" <> "createdBy"))'),
    ('PartnershipCode', 'PartnershipCode_status_check', '"status" IN (''ACTIVE'',''REVOKED'')'),
    ('PartnershipCode', 'PartnershipCode_counts_check', '"maxRedemptions" >= 1 AND "redeemedCount" >= 0 AND "redeemedCount" <= "maxRedemptions"'),
    ('PartnershipCodeRedemption', 'PartnershipCodeRedemption_amount_check', '"amountMinor" > 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- ── the points ledger guard ──
-- Serialises on the account row, refuses an entry that would make the balance negative, checks that a CONVERT names a LOYALTY lot of the same person, and moves the balance cache (only this trigger may).
CREATE OR REPLACE FUNCTION loyalty_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD; l RECORD; v_new bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF current_setting('kx.growth_maintenance', true) = 'on' THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
    RAISE EXCEPTION 'LoyaltyAccrualEntry is append-only: % is not allowed (append a REVERSE or EXPIRE entry)', TG_OP USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM "LoyaltyAccount" WHERE "id" = NEW."accountId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOYALTY_ACCOUNT_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  IF NEW."type" = 'CONVERT' THEN
    SELECT "kind", "sub", "funding" INTO l FROM "RewardLot" WHERE "id" = NEW."lotId";
    IF NOT FOUND OR l."kind" <> 'LOYALTY' OR l."sub" <> a."sub" OR l."funding" <> 'PLATFORM_MARKETING' THEN
      RAISE EXCEPTION 'LOYALTY_CONVERT_LOT_MISMATCH: a conversion must name a LOYALTY reward lot of the same person' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_new := a."pointsBalanceCache" + (CASE WHEN NEW."type" IN ('ACCRUE','TIER_BONUS') THEN NEW."points" ELSE -NEW."points" END);
  IF v_new < 0 THEN RAISE EXCEPTION 'LOYALTY_NEGATIVE_BALANCE: balance % cannot take % points off', a."pointsBalanceCache", NEW."points" USING ERRCODE = '23514'; END IF;
  PERFORM set_config('kx.loyalty_cache', 'on', true);
  UPDATE "LoyaltyAccount" SET "pointsBalanceCache" = v_new, "updatedAt" = timezone('UTC', now()) WHERE "id" = a."id";
  PERFORM set_config('kx.loyalty_cache', 'off', true);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS loyalty_entry_guard_ins ON "LoyaltyAccrualEntry";
CREATE TRIGGER loyalty_entry_guard_ins BEFORE INSERT ON "LoyaltyAccrualEntry" FOR EACH ROW EXECUTE FUNCTION loyalty_entry_guard();
DROP TRIGGER IF EXISTS loyalty_entry_immutable ON "LoyaltyAccrualEntry";
CREATE TRIGGER loyalty_entry_immutable BEFORE UPDATE OR DELETE ON "LoyaltyAccrualEntry" FOR EACH ROW EXECUTE FUNCTION loyalty_entry_guard();

-- The balance cache is moved by the ledger trigger only (never by an UPDATE from the application).
CREATE OR REPLACE FUNCTION loyalty_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."pointsBalanceCache" IS DISTINCT FROM OLD."pointsBalanceCache" AND current_setting('kx.loyalty_cache', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'LOYALTY_CACHE_LOCKED: the points balance moves only through ledger entries' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS loyalty_account_guard_upd ON "LoyaltyAccount";
CREATE TRIGGER loyalty_account_guard_upd BEFORE UPDATE ON "LoyaltyAccount" FOR EACH ROW EXECUTE FUNCTION loyalty_account_guard();

-- ── FIFO expiry ──
-- Replays the ledger lot by lot in time order (at the same instant: expiries first, then credits, then spends): a credit (ACCRUE, TIER_BONUS) opens a lot with its expiry; a spend (CONVERT, REVERSE) takes from the oldest lot that still has points; an EXPIRE entry closes every lot that had
-- expired by the time it was written. What is left in lots whose expiry is at or before p_now is expirable. The application runs this under the account lock before it accrues, converts or reads a balance.
CREATE OR REPLACE FUNCTION loyalty_expirable_points(p_account text, p_now timestamptz) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; v_left int[] := ARRAY[]::int[]; v_exp timestamptz[] := ARRAY[]::timestamptz[]; i int; v_need int; v_take int; v_total int := 0;
BEGIN
  FOR r IN SELECT "type", "points", "expiresAt", "createdAt" FROM "LoyaltyAccrualEntry" WHERE "accountId" = p_account ORDER BY "createdAt", (CASE WHEN "type" = 'EXPIRE' THEN 0 WHEN "type" IN ('ACCRUE', 'TIER_BONUS') THEN 1 ELSE 2 END), "id" LOOP
    IF r."type" IN ('ACCRUE', 'TIER_BONUS') THEN
      v_left := v_left || r."points"; v_exp := v_exp || r."expiresAt";
    ELSIF r."type" IN ('CONVERT', 'REVERSE') THEN
      v_need := r."points";
      FOR i IN 1 .. coalesce(array_length(v_left, 1), 0) LOOP
        EXIT WHEN v_need <= 0;
        v_take := LEAST(v_left[i], v_need); v_left[i] := v_left[i] - v_take; v_need := v_need - v_take;
      END LOOP;
    ELSIF r."type" = 'EXPIRE' THEN
      FOR i IN 1 .. coalesce(array_length(v_left, 1), 0) LOOP
        IF v_exp[i] <= r."createdAt" THEN v_left[i] := 0; END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOR i IN 1 .. coalesce(array_length(v_left, 1), 0) LOOP
    IF v_exp[i] <= p_now THEN v_total := v_total + v_left[i]; END IF;
  END LOOP;
  RETURN v_total;
END $$;

-- ── partnership programs ──
-- Activation and edits: the program may only run on a campaign of the same market that carries the PARTNER channel and has been approved through the campaign path (SCHEDULED or ACTIVE), within its budget.
-- Money fields are frozen once the program leaves DRAFT; ENDED is final.
CREATE OR REPLACE FUNCTION partnership_program_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'ENDED' AND current_setting('kx.growth_maintenance', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'PARTNERSHIP_ENDED: an ended program is final' USING ERRCODE = '23514'; END IF;
    IF OLD."status" <> 'DRAFT' AND (NEW."budgetMinor" <> OLD."budgetMinor" OR NEW."perRedemptionMinor" <> OLD."perRedemptionMinor" OR NEW."campaignId" IS DISTINCT FROM OLD."campaignId" OR NEW."fundingMode" <> OLD."fundingMode" OR NEW."kind" <> OLD."kind" OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt") THEN
      RAISE EXCEPTION 'PARTNERSHIP_FROZEN: the money terms cannot change after activation' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" IN ('ACTIVE','PAUSED') AND (TG_OP = 'INSERT' OR OLD."status" = 'DRAFT') THEN
    SELECT "market", "channels", "status", "budgetTotalMinor" INTO c FROM "GrowthCampaign" WHERE "id" = NEW."campaignId";
    IF NOT FOUND OR c."market" <> NEW."market" OR NOT ('PARTNER' = ANY (c."channels")) THEN RAISE EXCEPTION 'PARTNERSHIP_TERMS_INCOMPLETE: the campaign must exist in the same market with the PARTNER channel' USING ERRCODE = '23514'; END IF;
    IF c."status" NOT IN ('SCHEDULED','ACTIVE') THEN RAISE EXCEPTION 'PARTNERSHIP_TERMS_INCOMPLETE: the campaign is % (it must be approved through the campaign path first)', c."status" USING ERRCODE = '23514'; END IF;
    IF NEW."budgetMinor" > c."budgetTotalMinor" THEN RAISE EXCEPTION 'PARTNERSHIP_BUDGET_EXCEEDED: the program budget % is above the campaign budget %', NEW."budgetMinor", c."budgetTotalMinor" USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS partnership_program_guard_trg ON "PartnershipProgram";
CREATE TRIGGER partnership_program_guard_trg BEFORE INSERT OR UPDATE ON "PartnershipProgram" FOR EACH ROW EXECUTE FUNCTION partnership_program_guard();

-- A redemption: serialises on the program row, then enforces ACTIVE, the window, the campaign being ACTIVE, the budget (sum of redemptions plus this one at most the budget), the per-redemption value, the code limit and that
-- the lot is a PROMO lot issued for THIS program's campaign with the same amount. One per person per program (unique index).
CREATE OR REPLACE FUNCTION partnership_redemption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD; c RECORD; l RECORD; v_used bigint; v_n int;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF current_setting('kx.growth_maintenance', true) = 'on' THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
    RAISE EXCEPTION 'PartnershipCodeRedemption is append-only: % is not allowed', TG_OP USING ERRCODE = '55000';
  END IF;
  SELECT * INTO p FROM "PartnershipProgram" WHERE "id" = NEW."programId" FOR UPDATE;
  IF NOT FOUND OR p."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_ACTIVE: the program is not active' USING ERRCODE = '23514'; END IF;
  IF now() < p."startsAt" OR now() >= p."endsAt" THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_ACTIVE: outside the program window' USING ERRCODE = '23514'; END IF;
  SELECT "status" INTO c FROM "GrowthCampaign" WHERE "id" = p."campaignId";
  IF NOT FOUND OR c."status" <> 'ACTIVE' THEN RAISE EXCEPTION 'PARTNERSHIP_NOT_ACTIVE: the campaign is not active' USING ERRCODE = '23514'; END IF;
  IF NEW."amountMinor" <> p."perRedemptionMinor" THEN RAISE EXCEPTION 'PARTNERSHIP_TERMS_INCOMPLETE: the redemption value must equal the program value' USING ERRCODE = '23514'; END IF;
  SELECT coalesce(sum("amountMinor"), 0) INTO v_used FROM "PartnershipCodeRedemption" WHERE "programId" = NEW."programId";
  IF v_used + NEW."amountMinor" > p."budgetMinor" THEN RAISE EXCEPTION 'PARTNERSHIP_BUDGET_EXCEEDED: used % + % exceeds the budget %', v_used, NEW."amountMinor", p."budgetMinor" USING ERRCODE = '23514'; END IF;
  SELECT "kind", "campaignId", "amountMinor" INTO l FROM "RewardLot" WHERE "id" = NEW."lotId";
  IF NOT FOUND OR l."kind" <> 'PROMO' OR l."campaignId" IS DISTINCT FROM p."campaignId" OR l."amountMinor" <> NEW."amountMinor" THEN RAISE EXCEPTION 'PARTNERSHIP_LOT_MISMATCH: the lot was not issued for this program' USING ERRCODE = '23514'; END IF;
  UPDATE "PartnershipCode" SET "redeemedCount" = "redeemedCount" + 1
   WHERE "id" = NEW."codeId" AND "programId" = NEW."programId" AND "status" = 'ACTIVE' AND ("expiresAt" IS NULL OR "expiresAt" > now()) AND "redeemedCount" < "maxRedemptions";
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'PARTNERSHIP_CODE_EXHAUSTED: the code is revoked, expired or used up' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS partnership_redemption_guard_ins ON "PartnershipCodeRedemption";
CREATE TRIGGER partnership_redemption_guard_ins BEFORE INSERT ON "PartnershipCodeRedemption" FOR EACH ROW EXECUTE FUNCTION partnership_redemption_guard();
DROP TRIGGER IF EXISTS partnership_redemption_immutable ON "PartnershipCodeRedemption";
CREATE TRIGGER partnership_redemption_immutable BEFORE UPDATE OR DELETE ON "PartnershipCodeRedemption" FOR EACH ROW EXECUTE FUNCTION partnership_redemption_guard();

-- ── erasure (called by GrowthMaintenanceService after the older functions; this migration does not redefine them) ──
-- The account keeps its ledger (accounting) but loses the person: sub becomes a one-way hash. A redemption row is keyed by a hash only the application can compute, so the caller passes it.
CREATE OR REPLACE FUNCTION growth_erase_loyalty(p_sub text, p_sub_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_acc int := 0; v_red int := 0; v_hash text;
BEGIN
  IF p_sub IS NULL OR length(btrim(p_sub)) = 0 OR p_sub_hash IS NULL OR length(btrim(p_sub_hash)) = 0 THEN RAISE EXCEPTION 'growth_erase_loyalty: sub and sub hash are required' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('kx.growth_maintenance', 'on', true);
  v_hash := 'h:' || encode(sha256(convert_to(p_sub, 'UTF8')), 'hex');
  UPDATE "LoyaltyAccount" SET "sub" = v_hash WHERE "sub" = p_sub;
  GET DIAGNOSTICS v_acc = ROW_COUNT;
  UPDATE "PartnershipCodeRedemption" SET "subHash" = 'erased:' || "id" WHERE "subHash" = p_sub_hash;
  GET DIAGNOSTICS v_red = ROW_COUNT;
  RETURN jsonb_build_object('loyaltyAccountsAnonymised', v_acc, 'partnershipRedemptionsAnonymised', v_red);
END $$;
