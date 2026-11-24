-- GRW-P2-D (wave 6, KP): WhatsApp assistant working state. Additive and idempotent. Lands after the W5 spare slot (20261203099000) so it cannot collide with it.
-- Session context holds ids and counters only; confirmation nonces and hand-off link tokens are stored as hashes; the escalation transcript is redacted text (redactPhi) that purges with the escalation.

ALTER TABLE "AssistantSession" ADD COLUMN IF NOT EXISTS "context" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "AssistantEscalation" ADD COLUMN IF NOT EXISTS "transcript" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AssistantEscalation" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "AssistantEscalation" ADD COLUMN IF NOT EXISTS "closedBy" TEXT;

CREATE TABLE IF NOT EXISTS "AssistantConfirmation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetRef" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantConfirmation_nonceHash_key" ON "AssistantConfirmation"("nonceHash");
CREATE INDEX IF NOT EXISTS "AssistantConfirmation_sessionId_idx" ON "AssistantConfirmation"("sessionId");
CREATE INDEX IF NOT EXISTS "AssistantConfirmation_expiresAt_idx" ON "AssistantConfirmation"("expiresAt");

CREATE TABLE IF NOT EXISTS "AssistantLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantLink_tokenHash_key" ON "AssistantLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "AssistantLink_expiresAt_idx" ON "AssistantLink"("expiresAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantConfirmation_sessionId_fkey') THEN
    ALTER TABLE "AssistantConfirmation" ADD CONSTRAINT "AssistantConfirmation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantConfirmation_kind_check') THEN
    ALTER TABLE "AssistantConfirmation" ADD CONSTRAINT "AssistantConfirmation_kind_check" CHECK ("kind" IN ('BOOK','RESCHEDULE','CANCEL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantLink_intent_check') THEN
    ALTER TABLE "AssistantLink" ADD CONSTRAINT "AssistantLink_intent_check" CHECK ("intent" IN ('BOOK','VERIFY','PAY'));
  END IF;
END $$;
