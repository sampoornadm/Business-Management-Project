CREATE TABLE "hsn_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddedAt" TIMESTAMP(3),
    "embeddingVector" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hsn_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hsn_codes_code_key" ON "hsn_codes"("code");
CREATE INDEX "hsn_codes_codeLength_idx" ON "hsn_codes"("codeLength");
CREATE INDEX "hsn_codes_embeddingVector_hnsw_idx" ON "hsn_codes"
  USING hnsw ("embeddingVector" vector_cosine_ops);

CREATE TABLE "sac_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddedAt" TIMESTAMP(3),
    "embeddingVector" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sac_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sac_codes_code_key" ON "sac_codes"("code");
CREATE INDEX "sac_codes_codeLength_idx" ON "sac_codes"("codeLength");

CREATE TABLE "reference_data_imports" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceEtag" TEXT,
    "hsnRowCount" INTEGER NOT NULL,
    "sacRowCount" INTEGER NOT NULL,
    "triggeredById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_data_imports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reference_data_imports_dataset_importedAt_idx" ON "reference_data_imports"("dataset", "importedAt");
ALTER TABLE "reference_data_imports" ADD CONSTRAINT "reference_data_imports_triggeredById_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "settings" ADD CONSTRAINT "settings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
