-- GRW-P3-A (wave 7, lane A1, schema owner of the wave): experimentation and A/B testing.
-- Additive and idempotent. No existing function or index is replaced: erasure and retention for the exposure table are NEW functions
-- (growth_erase_experiments, growth_purge_experiments) that GrowthMaintenanceService calls after the existing ones, so this migration does not join the replay chain of growth-schema.int.spec.ts.
-- Safety (AD-8 / ADR-025): an experiment can never sit on an emergency, triage, safety, consent, privacy, regulatory, clinical, price, fee, cancellation-policy, payment, commission or attribution surface.
-- The allowlist lives in code (surfaces.ts); the CHECK below is the second wall and cannot be switched off by a flag.

CREATE TABLE IF NOT EXISTS "GrowthExperiment" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "variants" JSONB NOT NULL,
    "allocationBp" INTEGER NOT NULL DEFAULT 10000,
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "primaryMetric" TEXT NOT NULL,
    "guardrails" JSONB NOT NULL DEFAULT '[]',
    "mode" TEXT NOT NULL DEFAULT 'FIXED',
    "alphaBp" INTEGER NOT NULL DEFAULT 500,
    "minSample" INTEGER NOT NULL DEFAULT 1000,
    "plannedDays" INTEGER NOT NULL DEFAULT 14,
    "salt" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "flagKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthExperiment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthExperiment_market_key_key" ON "GrowthExperiment"("market", "key");
CREATE INDEX IF NOT EXISTS "GrowthExperiment_market_surface_status_idx" ON "GrowthExperiment"("market", "surface", "status");
CREATE INDEX IF NOT EXISTS "GrowthExperiment_status_idx" ON "GrowthExperiment"("status");

CREATE TABLE IF NOT EXISTS "GrowthExperimentExposure" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "variant" TEXT NOT NULL,
    "unitKind" TEXT NOT NULL,
    "unitHash" TEXT NOT NULL,
    "subRef" TEXT,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthExperimentExposure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthExperimentExposure_experimentId_unitHash_key" ON "GrowthExperimentExposure"("experimentId", "unitHash");
CREATE INDEX IF NOT EXISTS "GrowthExperimentExposure_experimentId_day_variant_idx" ON "GrowthExperimentExposure"("experimentId", "day", "variant");
CREATE INDEX IF NOT EXISTS "GrowthExperimentExposure_subRef_idx" ON "GrowthExperimentExposure"("subRef");
CREATE INDEX IF NOT EXISTS "GrowthExperimentExposure_firstAt_idx" ON "GrowthExperimentExposure"("firstAt");

CREATE TABLE IF NOT EXISTS "GrowthExperimentDaily" (
    "experimentId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "variant" TEXT NOT NULL,
    "exposures" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "guardrailCounts" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthExperimentDaily_pkey" PRIMARY KEY ("experimentId", "day", "variant")
);

CREATE TABLE IF NOT EXISTS "GrowthExperimentResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dayNumber" INTEGER NOT NULL DEFAULT 0,
    "verdict" TEXT NOT NULL,
    "srmP" DOUBLE PRECISION,
    "payload" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "GrowthExperimentResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GrowthExperimentResult_experimentId_computedAt_idx" ON "GrowthExperimentResult"("experimentId", "computedAt");

CREATE TABLE IF NOT EXISTS "GrowthExperimentEvent" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "diff" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "GrowthExperimentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GrowthExperimentEvent_experimentId_at_idx" ON "GrowthExperimentEvent"("experimentId", "at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthExperimentExposure_experimentId_fkey') THEN
    ALTER TABLE "GrowthExperimentExposure" ADD CONSTRAINT "GrowthExperimentExposure_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "GrowthExperiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthExperimentDaily_experimentId_fkey') THEN
    ALTER TABLE "GrowthExperimentDaily" ADD CONSTRAINT "GrowthExperimentDaily_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "GrowthExperiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthExperimentResult_experimentId_fkey') THEN
    ALTER TABLE "GrowthExperimentResult" ADD CONSTRAINT "GrowthExperimentResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "GrowthExperiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthExperimentEvent_experimentId_fkey') THEN
    ALTER TABLE "GrowthExperimentEvent" ADD CONSTRAINT "GrowthExperimentEvent_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "GrowthExperiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('GrowthExperiment', 'GrowthExperiment_status_check', '"status" IN (''DRAFT'',''PENDING_APPROVAL'',''RUNNING'',''STOPPED'',''CONCLUDED'',''ARCHIVED'')'),
    ('GrowthExperiment', 'GrowthExperiment_mode_check', '"mode" IN (''FIXED'',''SEQUENTIAL'')'),
    ('GrowthExperiment', 'GrowthExperiment_key_check', '"key" ~ ''^[a-z0-9][a-z0-9_-]{1,62}$'''),
    ('GrowthExperiment', 'GrowthExperiment_surface_format_check', '"surface" ~ ''^[a-z0-9][a-z0-9._-]{1,62}$'''),
    ('GrowthExperiment', 'GrowthExperiment_surface_never_check', '"surface" !~* ''(emergency|triage|symptom|safety|consent|privacy|regulat|clinical|diagnos|prescri|pricing|price|cancel|refund|payment|deposit|commission|attribution)|(^|[._-])(fees?|credits?|rewards?)([._-]|$)'''),
    ('GrowthExperiment', 'GrowthExperiment_allocation_check', '"allocationBp" BETWEEN 0 AND 10000'),
    ('GrowthExperiment', 'GrowthExperiment_alpha_check', '"alphaBp" BETWEEN 1 AND 2000'),
    ('GrowthExperiment', 'GrowthExperiment_sample_check', '"minSample" >= 1 AND "plannedDays" >= 1'),
    ('GrowthExperiment', 'GrowthExperiment_variants_check', 'jsonb_typeof("variants") = ''array'' AND jsonb_array_length("variants") BETWEEN 2 AND 5'),
    ('GrowthExperiment', 'GrowthExperiment_maker_checker_check', '"approvedBy" IS NULL OR "approvedBy" <> "createdBy"'),
    ('GrowthExperiment', 'GrowthExperiment_approved_check', '"status" IN (''DRAFT'',''PENDING_APPROVAL'',''ARCHIVED'') OR "approvedBy" IS NOT NULL'),
    ('GrowthExperiment', 'GrowthExperiment_stop_reason_check', '"status" <> ''STOPPED'' OR ("stopReason" IS NOT NULL AND "stoppedAt" IS NOT NULL)'),
    ('GrowthExperimentExposure', 'GrowthExperimentExposure_unit_kind_check', '"unitKind" IN (''VISITOR'',''SUB'')'),
    ('GrowthExperimentExposure', 'GrowthExperimentExposure_sub_ref_check', '("unitKind" = ''SUB'') OR "subRef" IS NULL'),
    ('GrowthExperimentDaily', 'GrowthExperimentDaily_counts_check', '"exposures" >= 0 AND "conversions" >= 0'),
    ('GrowthExperimentResult', 'GrowthExperimentResult_verdict_check', '"verdict" IN (''COLLECTING'',''SRM_DETECTED'',''GUARDRAIL_BREACH'',''NO_WINNER'',''WINNER'',''INCONCLUSIVE'')'),
    ('GrowthExperimentEvent', 'GrowthExperimentEvent_kind_check', '"kind" IN (''CREATED'',''EDITED'',''SUBMITTED'',''APPROVED'',''STARTED'',''STOPPED'',''CONCLUDED'',''ARCHIVED'',''SRM'',''GUARDRAIL'',''SHIP_REQUESTED'',''FLAG_OFF'')')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- A started experiment keeps its design: weights, allocation, salt, surface, metric, mode, alpha and sample plan never change (an assignment must be stable). Terminal states are final (ARCHIVED never leaves; a stopped or concluded experiment is never restarted).
CREATE OR REPLACE FUNCTION growth_experiment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GrowthExperiment is append-only history: DELETE is not allowed (archive it)' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ARCHIVED' THEN RAISE EXCEPTION 'GrowthExperiment % is archived and cannot change', OLD."id" USING ERRCODE = '55000'; END IF;
  IF OLD."status" IN ('STOPPED','CONCLUDED') AND NEW."status" NOT IN (OLD."status", 'ARCHIVED', 'CONCLUDED') THEN
    RAISE EXCEPTION 'GrowthExperiment % cannot leave % except to ARCHIVED', OLD."id", OLD."status" USING ERRCODE = '55000';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND (
       NEW."variants" IS DISTINCT FROM OLD."variants" OR NEW."allocationBp" IS DISTINCT FROM OLD."allocationBp" OR NEW."salt" IS DISTINCT FROM OLD."salt"
    OR NEW."surface" IS DISTINCT FROM OLD."surface" OR NEW."primaryMetric" IS DISTINCT FROM OLD."primaryMetric" OR NEW."mode" IS DISTINCT FROM OLD."mode"
    OR NEW."alphaBp" IS DISTINCT FROM OLD."alphaBp" OR NEW."minSample" IS DISTINCT FROM OLD."minSample" OR NEW."eligibility" IS DISTINCT FROM OLD."eligibility"
    OR NEW."market" IS DISTINCT FROM OLD."market" OR NEW."key" IS DISTINCT FROM OLD."key" OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt") THEN
    RAISE EXCEPTION 'GrowthExperiment % has started: its design (variants, allocation, salt, surface, metric, eligibility) is frozen', OLD."id" USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS growth_experiment_guard ON "GrowthExperiment";
CREATE TRIGGER growth_experiment_guard BEFORE UPDATE OR DELETE ON "GrowthExperiment" FOR EACH ROW EXECUTE FUNCTION growth_experiment_guard();

DROP TRIGGER IF EXISTS growth_experiment_result_immutable ON "GrowthExperimentResult";
CREATE TRIGGER growth_experiment_result_immutable BEFORE UPDATE OR DELETE ON "GrowthExperimentResult" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();
DROP TRIGGER IF EXISTS growth_experiment_event_immutable ON "GrowthExperimentEvent";
CREATE TRIGGER growth_experiment_event_immutable BEFORE UPDATE OR DELETE ON "GrowthExperimentEvent" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();

-- Erasure: an exposure of an authenticated person (unitKind SUB) is keyed by sha256(sub) in subRef; the daily counts already hold the aggregate, so the rows go.
-- Visitor exposures hold only an HMAC under the experiment salt (not linkable to a person without the visitor cookie) and age out with growth_purge_experiments.
CREATE OR REPLACE FUNCTION growth_erase_experiments(p_sub text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_ref text; v_n int := 0;
BEGIN
  IF p_sub IS NULL OR length(btrim(p_sub)) = 0 THEN
    RAISE EXCEPTION 'growth_erase_experiments: sub is required' USING ERRCODE = '22023';
  END IF;
  v_ref := encode(sha256(convert_to(p_sub, 'UTF8')), 'hex');
  DELETE FROM "GrowthExperimentExposure" WHERE "subRef" = v_ref;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('experimentExposuresDeleted', v_n);
END $$;

-- Retention: exposures older than p_months (default 13) are deleted; the daily rollups and result snapshots stay (aggregates).
CREATE OR REPLACE FUNCTION growth_purge_experiments(p_now timestamptz DEFAULT now(), p_months int DEFAULT 13) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_n int := 0;
BEGIN
  IF p_months < 1 THEN RAISE EXCEPTION 'growth_purge_experiments: months must be >= 1' USING ERRCODE = '22023'; END IF;
  DELETE FROM "GrowthExperimentExposure" WHERE "firstAt" < p_now - make_interval(months => p_months);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('experimentExposuresPurged', v_n);
END $$;
