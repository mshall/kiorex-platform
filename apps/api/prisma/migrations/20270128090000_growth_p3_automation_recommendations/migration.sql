-- GRW-P3-E (wave 8, lane A1): marketing automation (journey builder definitions) and AI-assisted campaign recommendations.
-- Slot reserved by GROWTH_PHASE2_4_WORK_PACKAGES section 4.3 for exactly this package. Additive and idempotent. No person-level column exists in any of these tables:
--   * LifecycleJourneyDefinition: a published graph is IMMUTABLE (trigger); only the kill switch and the PUBLISHED -> RETIRED move may change afterwards. Maker-checker is a CHECK (approver differs from author).
--   * LifecycleJourneyRunLog: counts only, one row per journey and day.
--   * GrowthRecommendation: aggregate references only. A CHECK rejects a payload that carries a person identifier key; the closed action vocabulary is a CHECK too.

CREATE TABLE IF NOT EXISTS "LifecycleJourneyDefinition" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL DEFAULT '',
    "graph" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "killedAt" TIMESTAMP(3),
    "killedBy" TEXT,
    "killReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifecycleJourneyDefinition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LifecycleJourneyDefinition_status_check" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','PUBLISHED','RETIRED')),
    CONSTRAINT "LifecycleJourneyDefinition_key_check" CHECK ("key" ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
    CONSTRAINT "LifecycleJourneyDefinition_maker_checker_check" CHECK ("approvedBy" IS NULL OR "approvedBy" <> "createdBy"),
    CONSTRAINT "LifecycleJourneyDefinition_published_check" CHECK ("status" NOT IN ('PUBLISHED','RETIRED') OR ("approvedBy" IS NOT NULL AND "publishedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "LifecycleJourneyDefinition_market_key_version_key" ON "LifecycleJourneyDefinition"("market", "key", "version");
CREATE INDEX IF NOT EXISTS "LifecycleJourneyDefinition_market_status_idx" ON "LifecycleJourneyDefinition"("market", "status");
-- one live version per (market, key)
CREATE UNIQUE INDEX IF NOT EXISTS "LifecycleJourneyDefinition_one_published_key" ON "LifecycleJourneyDefinition"("market", "key") WHERE "status" = 'PUBLISHED';

CREATE OR REPLACE FUNCTION growth_journey_definition_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('PUBLISHED','RETIRED') THEN RAISE EXCEPTION 'a published journey definition is immutable and cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('PUBLISHED','RETIRED') THEN
    IF NEW."graph" IS DISTINCT FROM OLD."graph" OR NEW."checksum" IS DISTINCT FROM OLD."checksum" OR NEW."key" IS DISTINCT FROM OLD."key" OR NEW."market" IS DISTINCT FROM OLD."market"
       OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy" OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy" OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."name" IS DISTINCT FROM OLD."name" THEN
      RAISE EXCEPTION 'a published journey definition is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED') THEN
      RAISE EXCEPTION 'a published journey definition can only move to RETIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LifecycleJourneyDefinition_guard" ON "LifecycleJourneyDefinition";
CREATE TRIGGER "LifecycleJourneyDefinition_guard" BEFORE UPDATE OR DELETE ON "LifecycleJourneyDefinition" FOR EACH ROW EXECUTE FUNCTION growth_journey_definition_guard();

CREATE TABLE IF NOT EXISTS "LifecycleJourneyRunLog" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "enrolled" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "ended" INTEGER NOT NULL DEFAULT 0,
    "byReason" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifecycleJourneyRunLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LifecycleJourneyRunLog_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "LifecycleJourneyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LifecycleJourneyRunLog_counts_check" CHECK ("enrolled" >= 0 AND "sent" >= 0 AND "skipped" >= 0 AND "ended" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "LifecycleJourneyRunLog_definitionId_day_key" ON "LifecycleJourneyRunLog"("definitionId", "day");

CREATE TABLE IF NOT EXISTS "GrowthRecommendation" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "kind" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "rationaleAr" TEXT NOT NULL DEFAULT '',
    "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "convertedRef" TEXT,
    "modelMode" TEXT NOT NULL DEFAULT 'rules',
    "aiSummary" JSONB,
    "feedback" TEXT,
    "feedbackBy" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthRecommendation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GrowthRecommendation_status_check" CHECK ("status" IN ('PROPOSED','APPROVED','REJECTED','EXPIRED','CONVERTED')),
    CONSTRAINT "GrowthRecommendation_kind_check" CHECK ("kind" IN ('REALLOCATE_BUDGET','PAUSE_CAMPAIGN','CONTENT_SUGGESTION','SEO_GAP','LIFECYCLE_HOLDOUT')),
    CONSTRAINT "GrowthRecommendation_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100),
    CONSTRAINT "GrowthRecommendation_model_mode_check" CHECK ("modelMode" IN ('rules','mock','real')),
    CONSTRAINT "GrowthRecommendation_feedback_check" CHECK ("feedback" IS NULL OR "feedback" IN ('USEFUL','NOT_USEFUL')),
    CONSTRAINT "GrowthRecommendation_decided_check" CHECK ("status" IN ('PROPOSED','EXPIRED') OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)),
    -- second wall behind assert-aggregate-only.ts: no person or health identifier key may appear anywhere in the payload, evidence or summary
    CONSTRAINT "GrowthRecommendation_aggregate_only_check" CHECK (
      ("payload"::text || "evidenceRefs"::text || COALESCE("aiSummary"::text, '')) !~* '"(sub|subject|subjecthash|userid|patientid|phone|email|msisdn|name|dob|nationalid|visitorkey|addresshash|deviceid|doctor|doctorref|provider|providerref|branchref|specialty|diagnosis|condition|symptom|icd|prescription|medication)"\s*:'
    )
);
CREATE INDEX IF NOT EXISTS "GrowthRecommendation_market_status_createdAt_idx" ON "GrowthRecommendation"("market", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GrowthRecommendation_expiresAt_idx" ON "GrowthRecommendation"("expiresAt") WHERE "status" = 'PROPOSED';
-- one open proposal per (market, kind, fingerprint): the engine is idempotent
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthRecommendation_open_fingerprint_key" ON "GrowthRecommendation"("market", "kind", "fingerprint") WHERE "status" = 'PROPOSED';

-- a decided recommendation keeps its evidence: the payload, kind, evidence and rationale never change after creation
CREATE OR REPLACE FUNCTION growth_recommendation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'recommendations are never deleted' USING ERRCODE = '23514'; END IF;
  IF NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."evidenceRefs" IS DISTINCT FROM OLD."evidenceRefs" OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
     OR NEW."market" IS DISTINCT FROM OLD."market" OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint" THEN
    RAISE EXCEPTION 'a recommendation''s evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'PROPOSED' AND NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'APPROVED' AND NEW."status" = 'CONVERTED') THEN
    RAISE EXCEPTION 'a decided recommendation cannot change its decision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "GrowthRecommendation_guard" ON "GrowthRecommendation";
CREATE TRIGGER "GrowthRecommendation_guard" BEFORE UPDATE OR DELETE ON "GrowthRecommendation" FOR EACH ROW EXECUTE FUNCTION growth_recommendation_guard();
