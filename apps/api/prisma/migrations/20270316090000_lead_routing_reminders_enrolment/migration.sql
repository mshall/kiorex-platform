-- Join requests: round-robin owner, reminder clock; onboarding drafts: the enrolment pre-created on approval of a CONNECTED draft.
-- Additive only: new nullable columns and one new table. Nothing existing changes.
ALTER TABLE "Lead" ADD COLUMN "lastTouchedAt" TIMESTAMP(3),
ADD COLUMN "assignedVia" TEXT,
ADD COLUMN "routingFlag" TEXT,
ADD COLUMN "remindedAt" TIMESTAMP(3),
ADD COLUMN "escalatedAt" TIMESTAMP(3);

ALTER TABLE "LeadOnboardingRequest" ADD COLUMN "enrolmentId" TEXT,
ADD COLUMN "enrolmentIssuedAt" TIMESTAMP(3),
ADD COLUMN "enrolmentIssuedBy" TEXT;

CREATE TABLE "LeadRoutingState" (
    "key" TEXT NOT NULL,
    "lastSub" TEXT,
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadRoutingState_pkey" PRIMARY KEY ("key")
);
