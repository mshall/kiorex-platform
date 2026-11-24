-- GRW-P3-D (wave 7 lane A3): fraud detection enhancements, SHADOW first (AD-11): a case, its signals and every decision. Schema owned by the W7 owner (lane A1).
-- Additive and idempotent. Subjects are keyed hashes (the same helper as GrowthFraudSignal), never an identifier. A case never changes an attribution decision or a reward by itself.

CREATE TABLE IF NOT EXISTS "FraudCase" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "subjectHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "band" TEXT NOT NULL DEFAULT 'LOW',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "mode" TEXT NOT NULL DEFAULT 'SHADOW',
    "slaDueAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "decision" TEXT,
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FraudCase_status_createdAt_idx" ON "FraudCase"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "FraudCase_subjectHash_idx" ON "FraudCase"("subjectHash");
-- one OPEN-like case per subject and kind (a new signal adds to it)
CREATE UNIQUE INDEX IF NOT EXISTS "FraudCase_one_open_idx" ON "FraudCase"("market", "subjectHash", "kind") WHERE "status" IN ('OPEN', 'IN_REVIEW', 'APPEALED');

CREATE TABLE IF NOT EXISTS "FraudCaseSignal" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "evidenceRef" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudCaseSignal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FraudCaseSignal_caseId_at_idx" ON "FraudCaseSignal"("caseId", "at");
CREATE UNIQUE INDEX IF NOT EXISTS "FraudCaseSignal_case_rule_evidence_key" ON "FraudCaseSignal"("caseId", "ruleId", "evidenceRef");

CREATE TABLE IF NOT EXISTS "FraudDecisionLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudDecisionLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FraudDecisionLog_caseId_at_idx" ON "FraudDecisionLog"("caseId", "at");

CREATE TABLE IF NOT EXISTS "FraudCalibration" (
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "ruleId" TEXT NOT NULL,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "dismissed" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FraudCalibration_pkey" PRIMARY KEY ("market", "day", "ruleId")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FraudCaseSignal_caseId_fkey') THEN
    ALTER TABLE "FraudCaseSignal" ADD CONSTRAINT "FraudCaseSignal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FraudCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FraudDecisionLog_caseId_fkey') THEN
    ALTER TABLE "FraudDecisionLog" ADD CONSTRAINT "FraudDecisionLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FraudCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('FraudCase', 'FraudCase_kind_check', '"kind" IN (''REFERRAL'',''REWARD'',''TOUCH'',''WIDGET'',''PROVIDER'')'),
    ('FraudCase', 'FraudCase_status_check', '"status" IN (''OPEN'',''IN_REVIEW'',''CONFIRMED'',''DISMISSED'',''APPEALED'',''CLOSED'')'),
    ('FraudCase', 'FraudCase_band_check', '"band" IN (''LOW'',''MEDIUM'',''HIGH'')'),
    ('FraudCase', 'FraudCase_mode_check', '"mode" IN (''SHADOW'',''ENFORCE'')'),
    ('FraudCase', 'FraudCase_score_check', '"score" BETWEEN 0 AND 100'),
    ('FraudCase', 'FraudCase_decided_check', '"status" NOT IN (''CONFIRMED'',''DISMISSED'') OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decision" IS NOT NULL)'),
    ('FraudCaseSignal', 'FraudCaseSignal_weight_check', '"weight" BETWEEN -100 AND 100'),
    ('FraudDecisionLog', 'FraudDecisionLog_action_check', '"action" IN (''OPENED'',''ASSIGNED'',''SCORED'',''CONFIRMED'',''DISMISSED'',''APPEALED'',''CLOSED'',''REOPENED'')'),
    ('FraudCalibration', 'FraudCalibration_counts_check', '"flagged" >= 0 AND "confirmed" >= 0 AND "dismissed" >= 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS fraud_case_signal_immutable ON "FraudCaseSignal";
CREATE TRIGGER fraud_case_signal_immutable BEFORE UPDATE OR DELETE ON "FraudCaseSignal" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();
DROP TRIGGER IF EXISTS fraud_decision_log_immutable ON "FraudDecisionLog";
CREATE TRIGGER fraud_decision_log_immutable BEFORE UPDATE OR DELETE ON "FraudDecisionLog" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only();

-- a decided case never reverts silently (an appeal moves it to APPEALED, a reviewer closes it), and a case with a log is never deleted
CREATE OR REPLACE FUNCTION fraud_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FraudCase is append-only history: DELETE is not allowed' USING ERRCODE = '55000'; END IF;
  IF OLD."status" IN ('CONFIRMED','DISMISSED') AND NEW."status" NOT IN (OLD."status", 'APPEALED', 'CLOSED') THEN
    RAISE EXCEPTION 'FraudCase % is decided (%): only APPEALED or CLOSED may follow', OLD."id", OLD."status" USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'CLOSED' AND NEW."status" <> 'CLOSED' THEN RAISE EXCEPTION 'FraudCase % is closed', OLD."id" USING ERRCODE = '55000'; END IF;
  IF OLD."subjectHash" IS DISTINCT FROM NEW."subjectHash" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."market" IS DISTINCT FROM NEW."market" THEN
    RAISE EXCEPTION 'FraudCase subject, kind and market are fixed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fraud_case_guard ON "FraudCase";
CREATE TRIGGER fraud_case_guard BEFORE UPDATE OR DELETE ON "FraudCase" FOR EACH ROW EXECUTE FUNCTION fraud_case_guard();
