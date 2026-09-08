-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "visibleColumns" JSONB NOT NULL,
    "columnOrder" JSONB NOT NULL,
    "sortBy" TEXT,
    "sortDir" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_views_userId_businessId_pageKey_idx" ON "saved_views"("userId", "businessId", "pageKey");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_userId_businessId_pageKey_name_key" ON "saved_views"("userId", "businessId", "pageKey", "name");

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
