import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TENDER_DOCUMENT_TYPE_FOLDER_NAMES, type TenderDocumentType } from "@bmp/types";

export interface TenderFolderInfo {
  tenderNumber: string;
  title: string;
}

const ILLEGAL_FS_CHARS = /[/\\:*?"<>|]/g;
const MAX_TITLE_LENGTH = 100;

function sanitizeTitle(title: string): string {
  const cleaned = title.replace(ILLEGAL_FS_CHARS, "-").trim();
  return cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH).trim() : cleaned;
}

// Only the title is sanitized — tenderNumber is used as-is (it's @unique and,
// in practice, plain alphanumeric). This keeps the leading token recoverable
// by tenderNumberFromFolderName even after a sanitization change.
export function tenderFolderName(tender: TenderFolderInfo): string {
  return `${tender.tenderNumber} - ${sanitizeTitle(tender.title)}`;
}

// Reverses tenderFolderName. The tender number is always the exact leading
// token before " - ", so this still resolves correctly even if the tender's
// title was edited after the folder was created (the on-disk name goes
// stale, but the leading token doesn't).
export function tenderNumberFromFolderName(folderName: string): string | null {
  const separatorIndex = folderName.indexOf(" - ");
  if (separatorIndex === -1) return null;
  return folderName.slice(0, separatorIndex);
}

const FOLDER_NAME_TO_DOCUMENT_TYPE = new Map<string, TenderDocumentType>(
  (Object.entries(TENDER_DOCUMENT_TYPE_FOLDER_NAMES) as [TenderDocumentType, string][]).map(
    ([type, folder]) => [folder.toLowerCase(), type],
  ),
);

// Files dropped directly in a tender's root folder, or into a subfolder name
// that doesn't match any known document type, default to GENERAL.
export function documentTypeForFolder(folderName: string | undefined): TenderDocumentType {
  if (!folderName) return "GENERAL";
  return FOLDER_NAME_TO_DOCUMENT_TYPE.get(folderName.toLowerCase()) ?? "GENERAL";
}

export function expandHome(dir: string): string {
  return dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
}

export async function ensureTenderFolders(rootDir: string, tender: TenderFolderInfo): Promise<void> {
  const tenderDir = path.join(expandHome(rootDir), tenderFolderName(tender));
  await Promise.all(
    Object.values(TENDER_DOCUMENT_TYPE_FOLDER_NAMES).map((folder) =>
      mkdir(path.join(tenderDir, folder), { recursive: true }),
    ),
  );
}
