import { writeFile } from "node:fs/promises";
import path from "node:path";

import { TENDER_DOCUMENT_TYPE_FOLDER_NAMES, type TenderDocumentType } from "@bmp/types";

import { GENERIC_UPLOAD_LIMITS } from "../../../config/constants.js";
import { env } from "../../../config/env.js";
import { prisma } from "../../../infra/prisma/client.js";
import { logger } from "../../../shared/logger/logger.js";
import { sha256 } from "../../../shared/utils/hash.js";
import { attachmentsService } from "../../attachments/attachments.module.js";
import { auditService } from "../../audit/audit.module.js";

import { ensureTenderFolders, expandHome, tenderFolderName } from "./folder-naming.js";

export interface SaveGeneratedTenderDocumentParams {
  tenderId: string;
  tenderNumber: string;
  tenderTitle: string;
  businessCode: string;
  documentType: TenderDocumentType;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  uploadedById: string;
}

// Called after a bill/undertaking PDF or DOCX is generated for download, to also make it a
// first-class Attachment (so it shows in the tender's Documents tab) and, when local-folder-sync
// is enabled, mirror it onto disk under the tender's folder — same convention the local-docs
// watcher uses in the other direction. Never throws: a persistence hiccup here must not break the
// download the caller is about to send.
export async function saveGeneratedTenderDocument(
  params: SaveGeneratedTenderDocumentParams,
): Promise<void> {
  try {
    const hash = sha256(params.buffer);
    const existing = await prisma.attachment.findFirst({
      where: { entityType: "Tender", entityId: params.tenderId, hash },
      select: { id: true },
    });

    if (!existing) {
      const { original } = await attachmentsService.upload({
        fileBuffer: params.buffer,
        originalName: params.filename,
        declaredMimeType: params.mimeType,
        entityType: "Tender",
        entityId: params.tenderId,
        uploadedById: params.uploadedById,
        allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
        maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
        generateImageVariants: false,
        documentType: params.documentType,
      });

      await auditService.log({
        actorId: params.uploadedById,
        action: "TENDER_DOCUMENT_UPLOADED",
        entityType: "Tender",
        entityId: params.tenderId,
        metadata: {
          documentType: params.documentType,
          attachmentId: original.id,
          source: "document-generation",
          originalName: params.filename,
        },
      });
    }

    if (env.LOCAL_DOCS_SYNC_ENABLED) {
      const folderInfo = { tenderNumber: params.tenderNumber, title: params.tenderTitle };
      await ensureTenderFolders(env.BUSINESSES_ROOT_DIR, params.businessCode, folderInfo);
      const dir = path.join(
        expandHome(env.BUSINESSES_ROOT_DIR),
        params.businessCode,
        "tenders",
        tenderFolderName(folderInfo),
        TENDER_DOCUMENT_TYPE_FOLDER_NAMES[params.documentType],
      );
      await writeFile(path.join(dir, params.filename), params.buffer);
    }
  } catch (error) {
    logger.error(
      `Failed to save generated document "${params.filename}" for tender ${params.tenderId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
