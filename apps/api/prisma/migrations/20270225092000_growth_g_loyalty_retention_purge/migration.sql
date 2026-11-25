-- Loyalty retention purge. The points ledger is append-only and the only way to remove rows is a SECURITY DEFINER function that raises the maintenance switch (same pattern as
-- growth_purge_corporate). Rule: an account that has had NO ledger entry for p_ledger_years (default 7) and holds no points is removed with its entries; ended partnership
-- programs whose end date is older than the same horizon lose their redemption rows (the budget of an ended program is no longer enforced). Anything with a balance, anything
-- active and anything newer is left alone. Returns the counts; idempotent.
CREATE OR REPLACE FUNCTION growth_purge_loyalty(p_now timestamptz DEFAULT now(), p_ledger_years int DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_entries int := 0; v_accounts int := 0; v_red int := 0; v_cut timestamptz;
BEGIN
  IF p_ledger_years < 1 THEN RAISE EXCEPTION 'growth_purge_loyalty: years must be >= 1' USING ERRCODE = '22023'; END IF;
  v_cut := p_now - make_interval(years => p_ledger_years);
  PERFORM set_config('kx.growth_maintenance', 'on', true);
  CREATE TEMP TABLE IF NOT EXISTS _loyalty_purge_accounts (id text PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _loyalty_purge_accounts;
  INSERT INTO _loyalty_purge_accounts
    SELECT a."id" FROM "LoyaltyAccount" a
     WHERE a."pointsBalanceCache" = 0 AND a."updatedAt" < v_cut
       AND NOT EXISTS (SELECT 1 FROM "LoyaltyAccrualEntry" e WHERE e."accountId" = a."id" AND e."createdAt" >= v_cut);
  DELETE FROM "LoyaltyAccrualEntry" e USING _loyalty_purge_accounts p WHERE e."accountId" = p.id;
  GET DIAGNOSTICS v_entries = ROW_COUNT;
  DELETE FROM "LoyaltyAccount" a USING _loyalty_purge_accounts p WHERE a."id" = p.id;
  GET DIAGNOSTICS v_accounts = ROW_COUNT;
  DELETE FROM "PartnershipCodeRedemption" r USING "PartnershipProgram" g WHERE r."programId" = g."id" AND g."status" = 'ENDED' AND g."endsAt" < v_cut;
  GET DIAGNOSTICS v_red = ROW_COUNT;
  PERFORM set_config('kx.growth_maintenance', 'off', true);
  RETURN jsonb_build_object('loyaltyLedgerEntriesPurged', v_entries, 'loyaltyAccountsPurged', v_accounts, 'partnershipRedemptionsPurged', v_red);
END $$;
