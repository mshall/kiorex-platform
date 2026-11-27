-- Founder decision A (27 Nov 2026): a healthcare provider operating in a country belongs to that country for life.
-- The projection of a provider (Provider) and the registration of a partner (PartnerConnection) can never be moved to another market by any code path:
-- the API refuses with MARKET_IMMUTABLE, and this trigger is the last line of defence. A correction is the documented super-admin data fix (ADR-060):
--   ALTER TABLE "Provider" DISABLE TRIGGER "Provider_market_immutable"; UPDATE ...; ALTER TABLE "Provider" ENABLE TRIGGER "Provider_market_immutable";
CREATE OR REPLACE FUNCTION kx_market_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."market" IS DISTINCT FROM OLD."market" THEN
    RAISE EXCEPTION 'MARKET_IMMUTABLE: % belongs to its country market for life (% -> % refused)', TG_TABLE_NAME, OLD."market", NEW."market" USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Provider_market_immutable" BEFORE UPDATE OF "market" ON "Provider"
  FOR EACH ROW EXECUTE FUNCTION kx_market_immutable();
CREATE TRIGGER "PartnerConnection_market_immutable" BEFORE UPDATE OF "market" ON "PartnerConnection"
  FOR EACH ROW EXECUTE FUNCTION kx_market_immutable();
