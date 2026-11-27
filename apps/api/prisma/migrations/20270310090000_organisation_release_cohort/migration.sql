-- G-COHORT: optional release cohort per organisation (additive side table; no row or a NULL cohort changes nothing).
CREATE TABLE "OrganisationAttribute" (
    "orgRef" TEXT NOT NULL,
    "releaseCohort" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationAttribute_pkey" PRIMARY KEY ("orgRef")
);

CREATE INDEX "OrganisationAttribute_releaseCohort_idx" ON "OrganisationAttribute"("releaseCohort");
