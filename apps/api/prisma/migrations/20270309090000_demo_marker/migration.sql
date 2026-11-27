-- Durable marker for seeded demo / dummy rows (additive side table; removal tool: npm run demo-data:remove).
CREATE TABLE "DemoMarker" (
    "tableName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL DEFAULT 'DEMO',
    "batch" TEXT NOT NULL DEFAULT 'seed-demo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoMarker_pkey" PRIMARY KEY ("tableName","rowId")
);

CREATE INDEX "DemoMarker_dataClass_tableName_idx" ON "DemoMarker"("dataClass", "tableName");
