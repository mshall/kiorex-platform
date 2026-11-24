-- GRW-P2-X1 (wave 5): erasure and retention for every Phase 2 table.
-- growth_erase_subject is REPLACED (same signature; Phase 1 behaviour kept verbatim, Phase 2 steps appended). growth_purge_expired stays as it is; growth_purge_expired_v2 calls it and then
-- purges the Phase 2 tables with the retention arguments below. Defaults are PROPOSED_DEFAULT: assistant turns 30 days, tool-call audit 12 months, lifecycle decisions 24 months,
-- reward ledger 7 years (accounting; counsel to confirm), referral qualification checks 24 months, job heartbeats 13 months.

CREATE OR REPLACE FUNCTION growth_erase_subject(p_sub text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_keys text[];
  v_anonymised int := 0;
  v_deleted int := 0;
  v_events int := 0;
  v_hash text;
  v_ref int := 0; v_code int := 0; v_signals int := 0; v_lots int := 0; v_life int := 0; v_enrol int := 0; v_dec int := 0; v_sessions int := 0;
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
  v_base jsonb; v_turns int := 0; v_tools int := 0; v_sessions int := 0; v_dec int := 0; v_ledger int := 0; v_lots int := 0; v_checks int := 0; v_jobs int := 0; v_result jsonb;
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

  PERFORM set_config('kx.growth_maintenance', 'off', true);
  v_result := v_base || jsonb_build_object('assistantTurnsDeleted', v_turns, 'assistantToolCallsDeleted', v_tools, 'assistantSessionsDeleted', v_sessions, 'lifecycleDecisionsDeleted', v_dec,
    'rewardLedgerEntriesDeleted', v_ledger, 'rewardLotsDeleted', v_lots, 'qualificationChecksDeleted', v_checks, 'jobRunsDeleted', v_jobs);
  INSERT INTO "AuditLog" ("id", "actor", "action", "resource", "resourceId", "metadata")
  VALUES (gen_random_uuid()::text, 'system:growth', 'growth.purge_expired_v2', 'GrowthRetention', NULL, v_result);
  RETURN v_result;
END $$;
