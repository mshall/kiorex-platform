-- Wave 9 GC-5: a second keyed phone hash the Clinic can recompute (contracts 1.13.0 staffPhoneMatchHash) for the RF_PROVIDER_COLLUSION staff match.
-- Hash only, never the phone; erased with the subject like every other signal. Additive: widens the allowed kinds of ReferralIdentitySignal.
ALTER TABLE "ReferralIdentitySignal" DROP CONSTRAINT IF EXISTS "ReferralIdentitySignal_kind_check";
ALTER TABLE "ReferralIdentitySignal" ADD CONSTRAINT "ReferralIdentitySignal_kind_check" CHECK ("kind" IN ('PHONE','PAY_FINGERPRINT','DEVICE','IP24','STAFF_MATCH'));
