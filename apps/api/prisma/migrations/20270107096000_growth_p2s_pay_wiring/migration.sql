-- GRW-P2-S Kiorex Pay wiring (wave 7 follow-up, lane A2). Additive and idempotent.
-- PaymentIntent: the provider-sponsored discount that reduced this deposit. `amountMinor` stays the CARD amount charged at the PSP; gross deposit = amountMinor + rewardMinor + sponsoredMinor.
--   sponsoredMinor        the sponsored line applied at checkout (provider funded, never paid out to the patient as cash or credit)
--   sponsoredPostedMinor  the part of it that sits in the Pay ledger HELD account (SPONSOR_FUNDED posting): only when REWARD_RULES.postToPayLedger is true (finance decision H-25, default false)
--   sponsoredVoidedMinor  the cumulative share voided by refunds (a refund voids its pro-rata share of the sponsored discount; never refunded to the patient)
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "sponsoredMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "sponsoredPostedMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "sponsoredVoidedMinor" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentIntent_sponsored_check') THEN
    ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_sponsored_check"
      CHECK ("sponsoredMinor" >= 0 AND "sponsoredPostedMinor" >= 0 AND "sponsoredVoidedMinor" >= 0 AND "sponsoredPostedMinor" <= "sponsoredMinor" AND "sponsoredVoidedMinor" <= "sponsoredMinor");
  END IF;
END $$;
