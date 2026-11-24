-- GRW-P1-B0 growth core (kiorex contracts 1.10.0): attribution, touchpoints, events, rollups, versioned growth config, slugs, landing pages,
-- widget registrations, fraud signals, suppression list, and two nullable BookingIntent columns. Additive and idempotent (IF NOT EXISTS / guarded blocks).

ALTER TABLE "BookingIntent" ADD COLUMN IF NOT EXISTS "acquisitionOrigin" TEXT,
ADD COLUMN IF NOT EXISTS "attributionDecisionId" TEXT;

CREATE TABLE IF NOT EXISTS "GrowthAcquisitionSource" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthAcquisitionSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthTouchpoint" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "visitorKey" TEXT,
    "sub" TEXT,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerOrgRef" TEXT,
    "linkCode" TEXT,
    "utmSource" VARCHAR(64),
    "utmMedium" VARCHAR(64),
    "utmCampaign" VARCHAR(64),
    "utmContent" VARCHAR(64),
    "utmTerm" VARCHAR(64),
    "clickIdKind" TEXT,
    "clickIdHash" TEXT,
    "referrerHost" VARCHAR(255),
    "landingKind" TEXT NOT NULL,
    "localeAt" TEXT NOT NULL DEFAULT 'ar',
    "dwellMs" INTEGER,
    "ltTokenId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT NOT NULL DEFAULT '',
    "uaClass" TEXT NOT NULL DEFAULT 'unknown',

    CONSTRAINT "GrowthTouchpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthAttributionDecision" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "bookingId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "evidenceTouchIds" TEXT[],
    "firstTouchId" TEXT,
    "lastTouchId" TEXT,
    "lastNonDirectTouchId" TEXT,
    "supersedesId" TEXT,
    "actor" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthAttributionDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthEvent" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "name" TEXT NOT NULL,
    "visitorKey" TEXT,
    "bookingId" TEXT,
    "careType" TEXT,
    "props" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthMetricDaily" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT '',
    "landingKind" TEXT NOT NULL DEFAULT '',
    "careType" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT '',
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthMetricDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthConfigVersion" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "scopeId" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "payload" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "ticket" TEXT,
    "reason" TEXT,
    "checksum" TEXT NOT NULL,
    "supersedesId" TEXT,

    CONSTRAINT "GrowthConfigVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthSlug" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthSlug_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthSlugHistory" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "replacedBy" TEXT,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthSlugHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthLandingPage" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "pageType" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "paramsKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "indexable" BOOLEAN NOT NULL DEFAULT false,
    "guardResult" JSONB,
    "lastRenderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthLandingPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WidgetRegistration" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "orgRef" TEXT NOT NULL,
    "orgSlug" TEXT,
    "origins" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthFraudSignal" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "ruleId" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "evidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthFraudSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunicationSuppression" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'EG',
    "channel" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "CommunicationSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthAcquisitionSource_market_sourceKind_sourceRef_key" ON "GrowthAcquisitionSource"("market", "sourceKind", "sourceRef");

CREATE INDEX IF NOT EXISTS "GrowthTouchpoint_visitorKey_occurredAt_idx" ON "GrowthTouchpoint"("visitorKey", "occurredAt");

CREATE INDEX IF NOT EXISTS "GrowthTouchpoint_sub_occurredAt_idx" ON "GrowthTouchpoint"("sub", "occurredAt");

CREATE INDEX IF NOT EXISTS "GrowthTouchpoint_providerOrgRef_occurredAt_idx" ON "GrowthTouchpoint"("providerOrgRef", "occurredAt");

CREATE INDEX IF NOT EXISTS "GrowthTouchpoint_market_occurredAt_idx" ON "GrowthTouchpoint"("market", "occurredAt");

CREATE INDEX IF NOT EXISTS "GrowthTouchpoint_sourceId_idx" ON "GrowthTouchpoint"("sourceId");

CREATE INDEX IF NOT EXISTS "GrowthAttributionDecision_bookingId_idx" ON "GrowthAttributionDecision"("bookingId");

CREATE INDEX IF NOT EXISTS "GrowthAttributionDecision_market_createdAt_idx" ON "GrowthAttributionDecision"("market", "createdAt");

CREATE INDEX IF NOT EXISTS "GrowthAttributionDecision_supersedesId_idx" ON "GrowthAttributionDecision"("supersedesId");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthAttributionDecision_bookingId_policyVersionId_key" ON "GrowthAttributionDecision"("bookingId", "policyVersionId");

CREATE INDEX IF NOT EXISTS "GrowthEvent_name_occurredAt_idx" ON "GrowthEvent"("name", "occurredAt");

CREATE INDEX IF NOT EXISTS "GrowthEvent_market_occurredAt_idx" ON "GrowthEvent"("market", "occurredAt");

CREATE INDEX IF NOT EXISTS "GrowthEvent_visitorKey_idx" ON "GrowthEvent"("visitorKey");

CREATE INDEX IF NOT EXISTS "GrowthEvent_bookingId_idx" ON "GrowthEvent"("bookingId");

CREATE INDEX IF NOT EXISTS "GrowthMetricDaily_day_idx" ON "GrowthMetricDaily"("day");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMetricDaily_market_day_metric_sourceKind_landingKind__key" ON "GrowthMetricDaily"("market", "day", "metric", "sourceKind", "landingKind", "careType", "origin");

CREATE INDEX IF NOT EXISTS "GrowthConfigVersion_kind_scope_scopeId_status_idx" ON "GrowthConfigVersion"("kind", "scope", "scopeId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthConfigVersion_kind_scope_scopeId_version_key" ON "GrowthConfigVersion"("kind", "scope", "scopeId", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthSlug_market_entityType_slug_key" ON "GrowthSlug"("market", "entityType", "slug");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthSlug_market_entityType_entityId_key" ON "GrowthSlug"("market", "entityType", "entityId");

CREATE INDEX IF NOT EXISTS "GrowthSlugHistory_entityType_entityId_idx" ON "GrowthSlugHistory"("entityType", "entityId");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthSlugHistory_market_entityType_slug_key" ON "GrowthSlugHistory"("market", "entityType", "slug");

CREATE INDEX IF NOT EXISTS "GrowthLandingPage_market_indexable_idx" ON "GrowthLandingPage"("market", "indexable");

CREATE UNIQUE INDEX IF NOT EXISTS "GrowthLandingPage_market_pageType_locale_paramsKey_key" ON "GrowthLandingPage"("market", "pageType", "locale", "paramsKey");

CREATE UNIQUE INDEX IF NOT EXISTS "WidgetRegistration_orgRef_key" ON "WidgetRegistration"("orgRef");

CREATE INDEX IF NOT EXISTS "WidgetRegistration_orgSlug_idx" ON "WidgetRegistration"("orgSlug");

CREATE INDEX IF NOT EXISTS "GrowthFraudSignal_ruleId_createdAt_idx" ON "GrowthFraudSignal"("ruleId", "createdAt");

CREATE INDEX IF NOT EXISTS "GrowthFraudSignal_subjectHash_idx" ON "GrowthFraudSignal"("subjectHash");

CREATE INDEX IF NOT EXISTS "CommunicationSuppression_addressHash_idx" ON "CommunicationSuppression"("addressHash");

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationSuppression_market_channel_addressHash_key" ON "CommunicationSuppression"("market", "channel", "addressHash");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthTouchpoint_sourceId_fkey') THEN
    ALTER TABLE "GrowthTouchpoint" ADD CONSTRAINT "GrowthTouchpoint_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GrowthAcquisitionSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthAttributionDecision_policyVersionId_fkey') THEN
    ALTER TABLE "GrowthAttributionDecision" ADD CONSTRAINT "GrowthAttributionDecision_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "GrowthConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Integrity: CHECK constraints (named, added once) and the partial unique index Prisma cannot model
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Immutable helper for the widget origin allow-list: exact https origins only, no wildcard, no path (mirrors @kiorex/contracts WIDGET_ORIGIN_PATTERN).
CREATE OR REPLACE FUNCTION growth_origins_valid(origins text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(bool_and(o ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$' AND length(o) <= 255), true)
  FROM unnest(origins) AS o
$$;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('BookingIntent', 'BookingIntent_acquisitionOrigin_check', '"acquisitionOrigin" IS NULL OR "acquisitionOrigin" IN (''PROVIDER_LED'',''MARKETPLACE'',''UNATTRIBUTED'')'),
    ('GrowthAttributionDecision', 'GrowthAttributionDecision_origin_check', '"origin" IN (''PROVIDER_LED'',''MARKETPLACE'',''UNATTRIBUTED'')'),
    ('GrowthAttributionDecision', 'GrowthAttributionDecision_hash_check', '"inputsHash" ~ ''^[0-9a-f]{64}$'''),
    ('GrowthTouchpoint', 'GrowthTouchpoint_dwell_check', '"dwellMs" IS NULL OR ("dwellMs" >= 0 AND "dwellMs" <= 600000)'),
    ('GrowthTouchpoint', 'GrowthTouchpoint_utm_no_email_check', 'coalesce("utmSource",'''') !~ ''@'' AND coalesce("utmMedium",'''') !~ ''@'' AND coalesce("utmCampaign",'''') !~ ''@'' AND coalesce("utmContent",'''') !~ ''@'' AND coalesce("utmTerm",'''') !~ ''@'''),
    ('GrowthConfigVersion', 'GrowthConfigVersion_scope_check', '("scope" = ''GLOBAL'' AND "scopeId" = '''') OR ("scope" = ''MARKET'' AND "scopeId" ~ ''^[A-Z]{2}$'')'),
    ('GrowthConfigVersion', 'GrowthConfigVersion_status_check', '"status" IN (''DRAFT'',''PENDING_APPROVAL'',''APPROVED'',''ACTIVE'',''SUPERSEDED'',''REJECTED'',''ROLLED_BACK'')'),
    ('GrowthConfigVersion', 'GrowthConfigVersion_maker_checker_check', '"approvedBy" IS NULL OR "approvedBy" <> "createdBy"'),
    ('GrowthConfigVersion', 'GrowthConfigVersion_version_check', '"version" >= 1'),
    ('GrowthConfigVersion', 'GrowthConfigVersion_window_check', '"effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom"'),
    ('GrowthSlug', 'GrowthSlug_format_check', '"slug" ~ ''^[a-z0-9-]{3,60}$'''),
    ('GrowthSlugHistory', 'GrowthSlugHistory_format_check', '"slug" ~ ''^[a-z0-9-]{3,60}$'''),
    ('WidgetRegistration', 'WidgetRegistration_origins_check', 'cardinality("origins") <= 10 AND growth_origins_valid("origins")'),
    ('CommunicationSuppression', 'CommunicationSuppression_channel_check', '"channel" IN (''WHATSAPP'',''SMS'',''EMAIL'',''PUSH'',''ALL'')')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- One ACTIVE version per (kind, scope, scopeId): resolve() always finds a single row.
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthConfigVersion_one_active_idx" ON "GrowthConfigVersion" ("kind", "scope", "scopeId") WHERE "status" = 'ACTIVE';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Immutability: GrowthTouchpoint and GrowthAttributionDecision are append-only (ARCH section 6.6)
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Touchpoints: UPDATE and DELETE raise, except inside the SECURITY DEFINER maintenance functions below (transaction-local marker).
CREATE OR REPLACE FUNCTION growth_touchpoint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('kx.growth_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'GrowthTouchpoint is append-only: % is not allowed (use growth_erase_subject or growth_purge_expired)', TG_OP USING ERRCODE = '55000';
END $$;

-- Decisions: no bypass at all. A correction is a new row with supersedesId. A decision holds no personal data, so erasure never needs to touch it.
CREATE OR REPLACE FUNCTION growth_attribution_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GrowthAttributionDecision is append-only: % is not allowed (insert a correction with supersedesId)', TG_OP USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS growth_touchpoint_immutable ON "GrowthTouchpoint";
CREATE TRIGGER growth_touchpoint_immutable BEFORE UPDATE OR DELETE ON "GrowthTouchpoint" FOR EACH ROW EXECUTE FUNCTION growth_touchpoint_guard();

DROP TRIGGER IF EXISTS growth_attribution_decision_immutable ON "GrowthAttributionDecision";
CREATE TRIGGER growth_attribution_decision_immutable BEFORE UPDATE OR DELETE ON "GrowthAttributionDecision" FOR EACH ROW EXECUTE FUNCTION growth_attribution_decision_guard();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Erasure and retention (SECURITY DEFINER, write an AuditLog row)
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Subject erasure (subject.deleted consumer). Touches that a decision cites as commission evidence are ANONYMISED (identifiers nulled) because the
-- evidence for a fee outlives the person; every other touch of the subject, and the visitor keys linked to the subject, is deleted together with
-- their funnel events. The AuditLog row stores sha256(sub), never the sub. Returns counts.
CREATE OR REPLACE FUNCTION growth_erase_subject(p_sub text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_keys text[];
  v_anonymised int := 0;
  v_deleted int := 0;
  v_events int := 0;
  v_result jsonb;
BEGIN
  IF p_sub IS NULL OR length(btrim(p_sub)) = 0 THEN
    RAISE EXCEPTION 'growth_erase_subject: sub is required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('kx.growth_maintenance', 'on', true);

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

  PERFORM set_config('kx.growth_maintenance', 'off', true);
  v_result := jsonb_build_object('touchpointsDeleted', v_deleted, 'touchpointsAnonymised', v_anonymised, 'eventsDeleted', v_events, 'visitorKeys', cardinality(v_keys));
  INSERT INTO "AuditLog" ("id", "actor", "action", "resource", "resourceId", "metadata")
  VALUES (gen_random_uuid()::text, 'system:growth', 'growth.erase_subject', 'GrowthSubject', encode(sha256(convert_to(p_sub, 'UTF8')), 'hex'), v_result);
  RETURN v_result;
END $$;

-- Retention (retention job). Parameters come from ATTRIBUTION_POLICY (defaults PROPOSED_DEFAULT: 25 months for touches linked to a decision,
-- 13 months for the rest, IP hash blanked after 24 hours, events 25 months, fraud signals 13 months). Idempotent.
CREATE OR REPLACE FUNCTION growth_purge_expired(p_now timestamptz DEFAULT now(), p_linked_months int DEFAULT 25, p_unlinked_months int DEFAULT 13) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_blanked int := 0; v_unlinked int := 0; v_linked int := 0; v_events int := 0; v_fraud int := 0;
  v_result jsonb;
BEGIN
  IF p_linked_months < 1 OR p_unlinked_months < 1 THEN
    RAISE EXCEPTION 'growth_purge_expired: retention months must be >= 1' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('kx.growth_maintenance', 'on', true);

  UPDATE "GrowthTouchpoint" SET "ipHash" = ''
   WHERE "ipHash" <> '' AND "occurredAt" < (p_now - interval '24 hours');
  GET DIAGNOSTICS v_blanked = ROW_COUNT;

  CREATE TEMP TABLE IF NOT EXISTS growth_cited_touches (id text PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE growth_cited_touches;
  INSERT INTO growth_cited_touches
    SELECT DISTINCT id FROM (
      SELECT unnest("evidenceTouchIds") AS id FROM "GrowthAttributionDecision"
      UNION ALL SELECT "firstTouchId" FROM "GrowthAttributionDecision"
      UNION ALL SELECT "lastTouchId" FROM "GrowthAttributionDecision"
      UNION ALL SELECT "lastNonDirectTouchId" FROM "GrowthAttributionDecision"
    ) u WHERE id IS NOT NULL;

  DELETE FROM "GrowthTouchpoint" t
   WHERE t."occurredAt" < (p_now - make_interval(months => p_unlinked_months))
     AND NOT EXISTS (SELECT 1 FROM growth_cited_touches c WHERE c.id = t."id");
  GET DIAGNOSTICS v_unlinked = ROW_COUNT;

  DELETE FROM "GrowthTouchpoint" t
   WHERE t."occurredAt" < (p_now - make_interval(months => p_linked_months))
     AND EXISTS (SELECT 1 FROM growth_cited_touches c WHERE c.id = t."id");
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  DELETE FROM "GrowthEvent" WHERE "occurredAt" < (p_now - make_interval(months => p_linked_months));
  GET DIAGNOSTICS v_events = ROW_COUNT;
  DELETE FROM "GrowthFraudSignal" WHERE "createdAt" < (p_now - make_interval(months => p_unlinked_months));
  GET DIAGNOSTICS v_fraud = ROW_COUNT;

  PERFORM set_config('kx.growth_maintenance', 'off', true);
  v_result := jsonb_build_object('ipHashBlanked', v_blanked, 'touchpointsDeletedUnlinked', v_unlinked, 'touchpointsDeletedLinked', v_linked, 'eventsDeleted', v_events, 'fraudSignalsDeleted', v_fraud);
  INSERT INTO "AuditLog" ("id", "actor", "action", "resource", "resourceId", "metadata")
  VALUES (gen_random_uuid()::text, 'system:growth', 'growth.purge_expired', 'GrowthRetention', NULL, v_result);
  RETURN v_result;
END $$;
