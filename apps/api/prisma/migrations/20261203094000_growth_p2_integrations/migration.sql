-- GRW-P2-X1 (wave 5): read-only marketing integration runs, external metrics, health and the growth job heartbeat table.

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthIntegrationRun" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "windowFrom" DATE,
    "windowTo" DATE,
    "status" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GrowthIntegrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthExternalMetricDaily" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "dimensionKey" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "currency" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthExternalMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthIntegrationHealth" (
    "kind" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "circuit" TEXT NOT NULL DEFAULT 'CLOSED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthIntegrationHealth_pkey" PRIMARY KEY ("kind","market")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthJobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "GrowthJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthIntegrationRun_kind_startedAt_idx" ON "GrowthIntegrationRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthExternalMetricDaily_kind_day_idx" ON "GrowthExternalMetricDaily"("kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthExternalMetricDaily_key" ON "GrowthExternalMetricDaily"("market", "kind", "day", "dimensionKey", "metric");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthJobRun_job_startedAt_idx" ON "GrowthJobRun"("job", "startedAt");

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('GrowthIntegrationRun', 'GrowthIntegrationRun_status_check', '"status" IN (''OK'',''PARTIAL'',''FAILED'')'),
    ('GrowthIntegrationRun', 'GrowthIntegrationRun_mode_check', '"mode" IN (''mock'',''real'')'),
    ('GrowthIntegrationHealth', 'GrowthIntegrationHealth_circuit_check', '"circuit" IN (''OPEN'',''CLOSED'',''HALF_OPEN'')')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
