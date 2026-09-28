-- One row per classifier rebuild, polled by the Settings card.
--
-- Hand-written rather than generated: `prisma migrate dev` treats the pgvector HNSW indexes as
-- undeclared drift and offers a "corrective" migration that drops them (see CLAUDE.md). Apply this
-- with `prisma migrate deploy`.
CREATE TABLE "classification_runs" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "trainedRows" INTEGER,
    "evalAccuracy" DOUBLE PRECISION,
    "evalTopK" DOUBLE PRECISION,
    "baselineAccuracy" DOUBLE PRECISION,
    "deployed" BOOLEAN NOT NULL DEFAULT false,
    "runPath" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "classification_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "classification_runs_startedAt_idx" ON "classification_runs"("startedAt");

-- SetNull, not Cascade: a run is a record of what happened to the model, and deleting the person
-- who pressed the button must not erase it.
ALTER TABLE "classification_runs"
    ADD CONSTRAINT "classification_runs_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
