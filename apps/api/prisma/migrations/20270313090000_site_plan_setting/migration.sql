-- Site text of the Pharmacy and Lab plan editions on the Kiorly site (no prices). Additive, one new table.
CREATE TABLE "SitePlanSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePlanSetting_pkey" PRIMARY KEY ("key")
);
