#!/usr/bin/env tsx
/**
 * Assigns the generated internal code to every Item that has none, and refreshes the HSN-heading
 * prefix on those that do. Idempotent — safe to re-run.
 *
 *   pnpm --filter @bmp/server exec tsx scripts/backfill-item-codes.ts
 */
import { prisma } from "../src/infra/prisma/client.js";
import { ItemsRepository } from "../src/modules/items/items.repository.js";

const repository = new ItemsRepository(prisma);

async function main(): Promise<void> {
  const items = await prisma.item.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const [index, item] of items.entries()) {
    await repository.ensureItemCode(item.id);
    if ((index + 1) % 100 === 0) console.log(`${index + 1}/${items.length}`);
  }
  console.log(`Done: ${items.length} items.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
