-- G-21: an APPROVED config version that has not taken effect can be withdrawn (terminal WITHDRAWN). Additive: one more allowed status, no row changes.
ALTER TABLE "GrowthConfigVersion" DROP CONSTRAINT IF EXISTS "GrowthConfigVersion_status_check";
ALTER TABLE "GrowthConfigVersion" ADD CONSTRAINT "GrowthConfigVersion_status_check" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','SUPERSEDED','REJECTED','ROLLED_BACK','WITHDRAWN'));
