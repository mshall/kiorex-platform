-- Gap closure: replayable continuity hint of a product fact (opaque ids only).
CREATE TABLE "GrowthContinuityHint" (
    "id" TEXT NOT NULL,
    "factKind" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "entryId" TEXT,
    "recordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthContinuityHint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GrowthContinuityHint_fact_key" ON "GrowthContinuityHint"("factKind", "factId");
CREATE INDEX "GrowthContinuityHint_createdAt_idx" ON "GrowthContinuityHint"("createdAt");

-- Contracts 1.13.0: the entry point remembers that its parent was named by the Clinic (appointmentId), so a later order does not re-infer another visit.
ALTER TABLE "CrossProductEntryPoint" ADD COLUMN "parentHinted" BOOLEAN NOT NULL DEFAULT false;
