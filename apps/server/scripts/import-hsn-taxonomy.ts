#!/usr/bin/env tsx
/**
 * Rebuilds the item category taxonomy and HSN GST rates from ml/data/hsn-gst-lookup.xlsx.
 *
 *   pnpm --filter @bmp/server exec tsx scripts/import-hsn-taxonomy.ts [sheetPath]
 *
 * Safe to re-run: nodes are matched by tariff code and updated in place, never deleted and
 * recreated, so existing Item.categoryId references survive.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/infra/prisma/client.js";
import { HsnTaxonomyImportService } from "../src/modules/reference-data/hsn-taxonomy-import.service.js";
import { ReferenceDataRepository } from "../src/modules/reference-data/reference-data.repository.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Wired by hand rather than imported from reference-data.module.js, like import-hsn-sac.ts: the
// composition root reaches the controller and routes, which pull in the Redis-backed queues, and
// those hold the event loop open so the script prints its result and then never exits.
const service = new HsnTaxonomyImportService(new ReferenceDataRepository(prisma));

async function main() {
  const sheetPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : HsnTaxonomyImportService.resolveSheetPath(REPO_ROOT);

  console.warn(`Importing taxonomy from ${sheetPath}`);
  const result = await service.importFromSheet(sheetPath);

  console.warn(
    [
      `  rows read:            ${result.rowsRead}`,
      `  chapters created:     ${result.chaptersCreated}`,
      `  headings created:     ${result.headingsCreated}`,
      `  nodes updated:        ${result.updated}`,
      `  legacy deactivated:   ${result.legacyDeactivated}`,
      `  HSN rates applied:    ${result.ratesApplied}`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
