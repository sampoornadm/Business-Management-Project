import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { GENERIC_UPLOAD_LIMITS } from "../../../config/constants.js";
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

export async function getSystemUserId(): Promise<string> {
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
export async function listAllTendersForFolderSync(): Promise<
  Array<TenderFolderInfo & { businessCode: string }>
> {
  const businesses = await prisma.business.findMany({ select: { id: true, code: true } });
  const tendersByBusiness = await Promise.all(
    businesses.map(async (business) => {
      const tenders = await prisma.tender.findMany({
        where: { businessId: business.id },
        select: { tenderNumber: true, title: true },
      });
      return tenders.map((tender) => ({ ...tender, businessCode: business.code }));
    }),
  );
  return tendersByBusiness.flat();
}

async function reconcileFolders(rootDir: string): Promise<void> {
  const tenders = await listAllTendersForFolderSync();
  await Promise.all(tenders.map((tender) => ensureTenderFolders(rootDir, tender.businessCode, tender)));
  logger.info(`Local docs sync: reconciled folders for ${tenders.length} tender(s) under ${rootDir}`);
}

async function importFile(rootDir: string, absolutePath: string): Promise<void> {
  const relative = path.relative(rootDir, absolutePath);
  const segments = relative.split(path.sep);
  // A file dropped outside <businessCode>/tenders/<tenderFolder>/ has nothing
  // to resolve against — nothing to do. Minimum shape: [businessCode, "tenders",
  // tenderFolder, filename] = 4 segments.
  if (segments.length < 4) return;

  const [businessCode, tendersSegment, tenderFolder, subfolder] = segments;
  if (tendersSegment !== "tenders") return;

  const business = await prisma.business.findUnique({
    where: { code: businessCode! },
    select: { id: true },
  });
  if (!business) {
    logger.warn(`Local docs sync: no business matches folder "${businessCode}" — skipping ${relative}`);
    return;
  }

  const tenderNumber = tenderNumberFromFolderName(tenderFolder!);
  if (!tenderNumber) return;

  const tender = await prisma.tender.findFirst({
    where: { tenderNumber, businessId: business.id },
    select: { id: true },
  });
  if (!tender) {
    logger.warn(
      `Local docs sync: no tender matches folder "${tenderFolder}" under business "${businessCode}" — skipping ${relative}`,
    );
    return;
  }

  const documentType = documentTypeForFolder(segments.length > 4 ? subfolder : undefined);

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
    depth: 5,
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
