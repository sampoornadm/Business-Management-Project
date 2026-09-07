-- CreateTable
CREATE TABLE "tender_pinned_notes" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "lineText" TEXT NOT NULL,
    "pinnedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_pinned_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tender_pinned_notes_tenderId_idx" ON "tender_pinned_notes"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_pinned_notes_tenderId_lineText_key" ON "tender_pinned_notes"("tenderId", "lineText");

-- AddForeignKey
ALTER TABLE "tender_pinned_notes" ADD CONSTRAINT "tender_pinned_notes_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_pinned_notes" ADD CONSTRAINT "tender_pinned_notes_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
