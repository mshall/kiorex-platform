-- Search "earliest" sort: cached next-slot time per provider so the whole catalogue can be ordered in SQL (unrated providers included, stable pagination).
ALTER TABLE "Provider" ADD COLUMN "nextSlotAt" TIMESTAMP(3);
ALTER TABLE "Provider" ADD COLUMN "slotIndexedAt" TIMESTAMP(3);
CREATE INDEX "Provider_status_nextSlotAt_idx" ON "Provider"("status", "nextSlotAt");
