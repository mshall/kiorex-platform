-- LG-COM-20: additive kind of a CASH tender (CASH | CASH_TRANSFER) and its detail (BANK_TRANSFER | INSTAPAY | CARD_TERMINAL). Nullable: older claims and older clients stay plain CASH / unknown.
ALTER TABLE "CommissionClaim" ADD COLUMN "tenderMethod" TEXT;
ALTER TABLE "CommissionClaim" ADD COLUMN "tenderDetail" TEXT;
