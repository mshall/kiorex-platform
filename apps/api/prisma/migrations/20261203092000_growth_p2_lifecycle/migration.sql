-- GRW-P2-X1 (wave 5): patient lifecycle CRM tables. PatientLifecycle is NON-CLINICAL by construction: no specialty, provider, diagnosis or visit-reason column
-- (a schema guard test lists the allowed columns). LifecycleMessageDecision is append-only (erasure and retention bypass inside the maintenance functions).

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatientLifecycle" (
    "sub" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "stage" TEXT NOT NULL,
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "lastBookingAt" TIMESTAMP(3),
    "lastAttendedAt" TIMESTAMP(3),
    "bookingsCount" INTEGER NOT NULL DEFAULT 0,
    "platform" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "city" TEXT,
    "district" TEXT,
    "referralStatus" TEXT NOT NULL DEFAULT 'NONE',
    "hasDependants" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PatientLifecycle_pkey" PRIMARY KEY ("sub","market")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LifecycleEnrollment" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "journeyKey" TEXT NOT NULL,
    "journeyVersion" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "step" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "LifecycleEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LifecycleMessageDecision" (
    "id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "journeyKey" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "messageClass" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageLogId" TEXT,

    CONSTRAINT "LifecycleMessageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LifecycleSegmentSnapshot" (
    "day" DATE NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "segmentKey" TEXT NOT NULL,
    "countBucket" TEXT NOT NULL,

    CONSTRAINT "LifecycleSegmentSnapshot_pkey" PRIMARY KEY ("day","market","segmentKey")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientLifecycle_market_stage_idx" ON "PatientLifecycle"("market", "stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LifecycleEnrollment_state_nextRunAt_idx" ON "LifecycleEnrollment"("state", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LifecycleEnrollment_sub_journeyKey_journeyVersion_key" ON "LifecycleEnrollment"("sub", "journeyKey", "journeyVersion");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LifecycleMessageDecision_sub_at_idx" ON "LifecycleMessageDecision"("sub", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LifecycleMessageDecision_journeyKey_step_at_idx" ON "LifecycleMessageDecision"("journeyKey", "step", "at");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('LifecycleEnrollment', 'LifecycleEnrollment_state_check', '"state" IN (''ACTIVE'',''ENDED'')'),
    ('LifecycleMessageDecision', 'LifecycleMessageDecision_class_check', '"messageClass" IN (''TRANSACTIONAL'',''SECURITY'',''CLINICAL'',''MARKETING'')'),
    ('LifecycleMessageDecision', 'LifecycleMessageDecision_decision_check', '"decision" IN (''SEND'',''SKIP'')')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS lifecycle_message_decision_immutable ON "LifecycleMessageDecision";
CREATE TRIGGER lifecycle_message_decision_immutable BEFORE UPDATE OR DELETE ON "LifecycleMessageDecision" FOR EACH ROW EXECUTE FUNCTION growth_p2_append_only_maint();
