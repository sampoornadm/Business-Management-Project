#!/usr/bin/env tsx
/**
 * Re-classifies the BOQ items of real tenders and prints what the classifier makes of them.
 *
 *   pnpm --filter @bmp/server exec tsx scripts/verify-classifier-on-tenders.ts [refNo...]
 *
 * Read-only: it classifies and reports, it does not write. The point is to see the codes on real
 * data before trusting them, particularly the two tenders this project was started from — 1400014205
 * is eight spring-steel items that must all land on one heading, and 1400014127 is 35 steel pipe
 * fittings that must land on 7307.
 */
import { env } from "../src/config/env.js";
import { prisma } from "../src/infra/prisma/client.js";
import { ClassificationService } from "../src/modules/classification/classification.service.js";

const DEFAULT_REFS = ["1400014205", "1400014127"];

async function main() {
  const refs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_REFS;
  const classifier = new ClassificationService({ minConfidence: env.CLASSIFIER_MIN_CONFIDENCE });

  if (!(await classifier.isAvailable())) {
    throw new Error("No trained model installed — run ml/train/train.py and build_index.py first.");
  }

  const categories = await prisma.category.findMany({
    where: { code: { not: null } },
    select: { code: true, name: true, parent: { select: { name: true } } },
  });
  const categoryByCode = new Map(
    categories.map((c) => [c.code!, c.parent ? `${c.parent.name} > ${c.name}` : c.name]),
  );

  // Tender is business-scoped and the Prisma client refuses an unscoped read, so search each
  // business in turn rather than reaching past the guard.
  const businesses = await prisma.business.findMany({ select: { id: true } });

  for (const refNo of refs) {
    let tender: { id: string; title: string } | null = null;
    let businessId = "";
    for (const business of businesses) {
      tender = await prisma.tender.findFirst({
        where: { businessId: business.id, tenderNumber: refNo },
        select: { id: true, title: true },
      });
      if (tender) {
        businessId = business.id;
        break;
      }
    }
    if (!tender) {
      console.warn(`\n=== ${refNo}: no such tender ===`);
      continue;
    }

    const boq = await prisma.boq.findFirst({
      where: { businessId, tenderId: tender.id, isCurrent: true },
      select: { id: true },
    });
    if (!boq) {
      console.warn(`\n=== ${refNo}: no current BOQ ===`);
      continue;
    }

    const items = await prisma.boqItem.findMany({
      where: { boqId: boq.id, description: { not: "" } },
      select: { description: true, hsnCode: true, suggestedHsnCode: true },
      orderBy: { sortOrder: "asc" },
    });

    const results = await classifier.classifyMany(items.map((i) => i.description));
    const headings = new Map<string, number>();

    console.warn(`\n=== ${refNo} — ${tender.title} (${items.length} items) ===`);
    for (const [index, item] of items.entries()) {
      const result = results[index]!;
      const code = result.headingCode ?? "(abstained)";
      headings.set(code, (headings.get(code) ?? 0) + 1);
      const was = item.suggestedHsnCode?.slice(0, 4) ?? item.hsnCode?.slice(0, 4) ?? "-";
      console.warn(
        `  ${was.padEnd(6)} -> ${code.padEnd(11)} conf ${result.confidence.toFixed(3)}  ` +
          `${(categoryByCode.get(code) ?? "").slice(0, 44).padEnd(45)}${item.description.slice(0, 48)}`,
      );
    }

    const summary = [...headings.entries()].sort((a, b) => b[1] - a[1]);
    console.warn(`  distinct headings: ${summary.map(([c, n]) => `${c}x${n}`).join(", ")}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
