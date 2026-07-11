import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { GENERIC_UPLOAD_LIMITS } from "../../../config/constants.js";
import { listAllBusinessIds } from "../../../infra/prisma/business-ids.js";
import { prisma } from "../../../infra/prisma/client.js";
import { logger } from "../../../shared/logger/logger.js";
import { attachmentsService } from "../../attachments/attachments.module.js";
import { auditService } from "../../audit/audit.module.js";

import {
  documentTypeForFolder,
  ensureTenderFolders,
  expandHome,
  tenderNumberFromFolderName,
  type TenderFolderInfo,
} from "./folder-naming.js";

// Kept in sync with packages/database/prisma/seed.ts's LOCAL_DOCS_SYNC_USER_EMAIL.
const LOCAL_DOCS_SYNC_USER_EMAIL = "local-sync@bmp.local";

let cachedSystemUserId: string | undefined;

async function getSystemUserId(): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;
  const user = await prisma.user.findUnique({
    where: { email: LOCAL_DOCS_SYNC_USER_EMAIL },
    select: { id: true },
  });
  if (!user) {
    throw new Error(
      `Local docs sync system user (${LOCAL_DOCS_SYNC_USER_EMAIL}) not found — run \`pnpm db:seed\` first`,
    );
  }
  cachedSystemUserId = user.id;
  return user.id;
}

// file-type sniffing (used by attachmentsService.upload) can't detect plain
// text from magic bytes, so it needs a hint here; everything else (PDFs,
// images, office docs) is reliably sniffed from content regardless of what's
// declared.
function guessDeclaredMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".txt" || ext === ".md" ? "text/plain" : "application/octet-stream";
}

/**
 * Lists every tender across every business. `Tender` is a business-scoped model (see
 * scoped-client.ts's `SCOPED_MODELS`), so a single global query is refused at query time — this
 * folder sync is meant to guarantee a local folder for every tender in the system regardless of
 * which business it belongs to (one shared root directory, one flat namespace of tender folders),
 * so instead of weakening the guard it loops a scoped, per-business query and concatenates the
 * results, same pattern as `listAllBusinessIds()`'s doc comment in `business-ids.ts` describes for
 * cross-business background jobs (e.g. the tender-reminder worker).
 */
export async function listAllTendersForFolderSync(): Promise<TenderFolderInfo[]> {
  const businessIds = await listAllBusinessIds(prisma);
  const tendersByBusiness = await Promise.all(
    businessIds.map((businessId) =>
      prisma.tender.findMany({ where: { businessId }, select: { tenderNumber: true, title: true } }),
    ),
  );
  return tendersByBusiness.flat();
}

async function reconcileFolders(rootDir: string): Promise<void> {
  const tenders = await listAllTendersForFolderSync();
  await Promise.all(tenders.map((tender) => ensureTenderFolders(rootDir, tender)));
  logger.info(`Local docs sync: reconciled folders for ${tenders.length} tender(s) under ${rootDir}`);
}

/**
 * Resolves a folder name's tenderNumber to the one tender it refers to, across every business.
 * `Tender.tenderNumber` is `@unique` at the top level of the schema (not compound with
 * `businessId`), and local-docs folders carry no business segment in their naming scheme, so there
 * is no businessId to target up front. `Tender` is still a business-scoped model (see
 * scoped-client.ts's `SCOPED_MODELS`), so this loops `listAllBusinessIds()` (same cross-business
 * pattern documented in `business-ids.ts` and used by `listAllTendersForFolderSync()` above) and
 * runs a scoped, per-business lookup, stopping at the first match — since `tenderNumber` is
 * globally unique, at most one business can ever match, so there's no need to keep checking the
 * rest once found. Uses `findFirst` (not `findUnique`) because `{ tenderNumber, businessId }`
 * together isn't a compound unique constraint — the same reasoning `purchase-orders.repository.ts`
 * and `finance.repository.ts` document on their own per-business `findFirst` lookups.
 */
export async function findTenderByNumberAcrossBusinesses(tenderNumber: string): Promise<{ id: string } | null> {
  const businessIds = await listAllBusinessIds(prisma);
  for (const businessId of businessIds) {
    const tender = await prisma.tender.findFirst({
      where: { tenderNumber, businessId },
      select: { id: true },
    });
    if (tender) return tender;
  }
  return null;
}

async function importFile(rootDir: string, absolutePath: string): Promise<void> {
  const relative = path.relative(rootDir, absolutePath);
  const segments = relative.split(path.sep);
  // A file dropped directly at the watch root, outside any tender folder,
  // has nothing to resolve against — nothing to do.
  if (segments.length < 2) return;

  const [tenderFolder, subfolder] = segments;
  const tenderNumber = tenderNumberFromFolderName(tenderFolder!);
  if (!tenderNumber) return;

  const tender = await findTenderByNumberAcrossBusinesses(tenderNumber);
  if (!tender) {
    logger.warn(`Local docs sync: no tender matches folder "${tenderFolder}" — skipping ${relative}`);
    return;
  }

  const documentType = documentTypeForFolder(segments.length > 2 ? subfolder : undefined);

  const buffer = await readFile(absolutePath);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const existing = await prisma.attachment.findFirst({
    where: { entityType: "Tender", entityId: tender.id, hash },
    select: { id: true },
  });
  if (existing) return; // already imported (watcher restart / initial scan replay)

  const systemUserId = await getSystemUserId();
  const originalName = path.basename(absolutePath);

  const { original } = await attachmentsService.upload({
    fileBuffer: buffer,
    originalName,
    declaredMimeType: guessDeclaredMimeType(absolutePath),
    entityType: "Tender",
    entityId: tender.id,
    uploadedById: systemUserId,
    allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
    maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    generateImageVariants: false,
    documentType,
  });

  await auditService.log({
    actorId: systemUserId,
    action: "TENDER_DOCUMENT_UPLOADED",
    entityType: "Tender",
    entityId: tender.id,
    metadata: { documentType, attachmentId: original.id, source: "local-folder-sync", originalName },
  });

  logger.info(`Local docs sync: imported "${originalName}" (${documentType}) for tender ${tenderNumber}`);
}

export async function startLocalDocsWatcher(rootDirRaw: string): Promise<FSWatcher> {
  const rootDir = expandHome(rootDirRaw);
  await reconcileFolders(rootDir);

  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 3,
  });

  watcher.on("add", (filePath) => {
    void importFile(rootDir, filePath).catch((error: unknown) => {
      logger.error(
        `Local docs sync: failed to import ${filePath}: ${error instanceof Error ? error.message : error}`,
      );
    });
  });

  logger.info(`Local docs sync: watching ${rootDir}`);
  return watcher;
}
