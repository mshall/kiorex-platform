-- GRW-P2-X1 (wave 5): WhatsApp assistant tables. Turn text is redacted before it is stored and purged after purgeAfter (default 30 days).

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssistantSession" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "channelConversationId" TEXT NOT NULL,
    "sub" TEXT,
    "phoneHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'START',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "consentVersion" TEXT NOT NULL DEFAULT '',
    "tokenBudgetUsed" INTEGER NOT NULL DEFAULT 0,
    "costMinorUsed" INTEGER NOT NULL DEFAULT 0,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "lastToolAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssistantTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "redactedText" TEXT NOT NULL DEFAULT '',
    "intent" TEXT,
    "toolName" TEXT,
    "modelMode" TEXT NOT NULL DEFAULT 'mock',
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssistantToolCall" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "argsRedacted" JSONB NOT NULL DEFAULT '{}',
    "resultKind" TEXT NOT NULL,
    "resultRef" TEXT,
    "confirmNonceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssistantUsageDaily" (
    "day" DATE NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "breakerTripped" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantUsageDaily_pkey" PRIMARY KEY ("day","market")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssistantEscalation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ackBy" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantSession_channelConversationId_key" ON "AssistantSession"("channelConversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantSession_sub_idx" ON "AssistantSession"("sub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantSession_phoneHash_idx" ON "AssistantSession"("phoneHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantSession_expiresAt_idx" ON "AssistantSession"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantTurn_purgeAfter_idx" ON "AssistantTurn"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantTurn_sessionId_seq_direction_key" ON "AssistantTurn"("sessionId", "seq", "direction");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantToolCall_turnId_idx" ON "AssistantToolCall"("turnId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantToolCall_createdAt_idx" ON "AssistantToolCall"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssistantEscalation_status_slaDueAt_idx" ON "AssistantEscalation"("status", "slaDueAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantTurn_sessionId_fkey') THEN
    ALTER TABLE "AssistantTurn" ADD CONSTRAINT "AssistantTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantToolCall_turnId_fkey') THEN
    ALTER TABLE "AssistantToolCall" ADD CONSTRAINT "AssistantToolCall_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AssistantTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantEscalation_sessionId_fkey') THEN
    ALTER TABLE "AssistantEscalation" ADD CONSTRAINT "AssistantEscalation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('AssistantTurn', 'AssistantTurn_direction_check', '"direction" IN (''IN'',''OUT'')'),
    ('AssistantEscalation', 'AssistantEscalation_status_check', '"status" IN (''OPEN'',''ACKED'',''CLOSED'')'),
    ('AssistantUsageDaily', 'AssistantUsageDaily_nonneg_check', '"tokens" >= 0 AND "costMinor" >= 0 AND "conversations" >= 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
