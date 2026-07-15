import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { ConflictError } from "../../../core/errors/HttpErrors.js";
import { generateJson } from "../../../infra/llm/ollama.client.js";
import { prisma } from "../../../infra/prisma/client.js";
import { logger } from "../../../shared/logger/logger.js";
import { auditService } from "../../audit/audit.module.js";
import { boqService } from "../../boq/boq.module.js";
import { organizationsRepository, organizationsService } from "../../organizations/organizations.module.js";
import { extractDocumentText } from "../tender-extraction.parser.js";
import { TenderExtractionService } from "../tender-extraction.service.js";
import { tendersService } from "../tenders.module.js";

import { getSystemUserId } from "./docs-watcher.service.js";
import { ensureTenderFolders, expandHome, tenderFolderName } from "./folder-naming.js";
import { buildDraftTenderData } from "./incoming-tender-mapper.js";

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function moveToSubfolder(rootDir: string, businessCode: string, filename: string, subfolder: string): Promise<void> {
  const targetDir = path.join(rootDir, businessCode, "incoming-tenders", subfolder);
  await mkdir(targetDir, { recursive: true });
  const sourcePath = path.join(rootDir, businessCode, "incoming-tenders", filename);
  await rename(sourcePath, path.join(targetDir, filename));
}

export async function processIncomingTenderFile(
  rootDir: string,
  absolutePath: string,
  extractionService: TenderExtractionService,
): Promise<void> {
  const relative = path.relative(rootDir, absolutePath);
  const segments = relative.split(path.sep);
  // Only [businessCode, "incoming-tenders", filename] — 3 segments exactly. A path
  // inside incoming-tenders/duplicates/ or incoming-tenders/errors/ (created by this
  // same function below) has 4 segments and must NOT be re-processed.
  if (segments.length !== 3) return;

  const [businessCode, folderSegment, filename] = segments;
  if (folderSegment !== "incoming-tenders") return;

  const mimeType = EXTENSION_TO_MIME_TYPE[path.extname(filename!).toLowerCase()];
  if (!mimeType) return; // ignore stray non-document files (e.g. .DS_Store)

  const business = await prisma.business.findUnique({ where: { code: businessCode! }, select: { id: true } });
  if (!business) {
    logger.warn(`Incoming tenders: no business matches folder "${businessCode}" — skipping ${relative}`);
    return;
  }

  const buffer = await readFile(absolutePath);
  const result = await extractionService.extractFromDocument(buffer, mimeType);

  const systemUserId = await getSystemUserId();
  const draft = buildDraftTenderData(result.fields, business.id, systemUserId);
  if (!draft) {
    logger.warn(
      `Incoming tenders: could not extract tenderNumber/submissionDate from "${filename}" — leaving in place for manual review`,
    );
    return;
  }

  let clientId = result.suggestedClientId;
  if (!clientId) {
    const clientName = result.suggestedClientName ?? draft.title;
    const organization = await organizationsService.create({
      name: clientName,
      type: "PRIVATE",
      notes: "Auto-created from incoming-tenders ingestion — verify type/GST/address.",
      createdById: systemUserId,
    });
    clientId = organization.id;
  }

  let tender;
  try {
    tender = await tendersService.create({ ...draft, clientId }, { businessId: business.id });
  } catch (error) {
    if (error instanceof ConflictError) {
      await moveToSubfolder(rootDir, businessCode!, filename!, "duplicates");
      logger.warn(
        `Incoming tenders: tender ${draft.tenderNumber} already exists — moved "${filename}" to duplicates/`,
      );
      return;
    }
    throw error;
  }

  if (result.items.length > 0) {
    await boqService.commitBoq(
      tender.id,
      business.id,
      {
        items: result.items.map((item, index) => ({
          tempId: String(index),
          itemCode: item.itemCode,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
        })),
      },
      systemUserId,
      {},
    );
  }

  // tendersService.create() already fire-and-forgets ensureTenderFolders — call it
  // again ourselves, awaited, so the NIT folder is guaranteed to exist before this
  // function moves the file into it (the fire-and-forget call inside create() has
  // no guaranteed completion time relative to this function returning).
  await ensureTenderFolders(rootDir, businessCode!, tender);
  const nitPath = path.join(
    expandHome(rootDir),
    businessCode!,
    "tenders",
    tenderFolderName(tender),
    "NIT",
    filename!,
  );
  await rename(absolutePath, nitPath);

  await auditService.log({
    actorId: systemUserId,
    action: "TENDER_AUTO_CREATED_FROM_INGESTION",
    entityType: "Tender",
    entityId: tender.id,
    metadata: { sourceFilename: filename, itemCount: result.items.length },
  });

  logger.info(`Incoming tenders: created tender ${tender.tenderNumber} from "${filename}"`);
}

export async function startIncomingTendersWatcher(rootDirRaw: string): Promise<FSWatcher> {
  const rootDir = expandHome(rootDirRaw);
  const extractionService = new TenderExtractionService(organizationsRepository, generateJson, extractDocumentText);

  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 3,
  });

  watcher.on("add", (filePath) => {
    void processIncomingTenderFile(rootDir, filePath, extractionService).catch((error: unknown) => {
      logger.error(
        `Incoming tenders: failed to process ${filePath}: ${error instanceof Error ? error.message : error}`,
      );
    });
  });

  logger.info(`Incoming tenders: watching ${rootDir}`);
  return watcher;
}
