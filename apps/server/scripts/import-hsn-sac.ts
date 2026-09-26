#!/usr/bin/env tsx
/**
 * One-off / manual initial seed for the HSN/SAC reference tables. Usage:
 *   pnpm --filter @bmp/server exec tsx scripts/import-hsn-sac.ts [path/to/HSN_SAC.xlsx]
 * With no argument, fetches the live CBIC file (same URL the scheduled job uses).
 */
import { readFile } from "node:fs/promises";

import { prisma } from "../src/infra/prisma/client.js";
import { CBIC_HSN_SAC_URL, HsnSacImportService } from "../src/modules/reference-data/hsn-sac-import.service.js";
import { ReferenceDataRepository } from "../src/modules/reference-data/reference-data.repository.js";

async function main() {
  const filePath = process.argv[2];
  const repository = new ReferenceDataRepository(prisma);
  const service = new HsnSacImportService(repository);

  if (filePath) {
    const buffer = await readFile(filePath);
    const result = await service.importFromBuffer(buffer, `file://${filePath}`, null, null);
    console.log(`Imported from ${filePath}:`, result);
  } else {
    const result = await service.fetchAndImport(null);
    console.log(`Imported from ${CBIC_HSN_SAC_URL}:`, result ?? "unchanged (304)");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
