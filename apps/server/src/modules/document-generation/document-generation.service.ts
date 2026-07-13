import { stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env.js";
import { expandHome } from "../tenders/local-docs/folder-naming.js";

export type DocumentType = "undertaking";

export interface TemplateStatus {
  documentType: DocumentType;
  filename: string;
  path: string;
  exists: boolean;
  lastModifiedAt: string | null;
}

const TEMPLATE_FILENAMES: Record<DocumentType, string> = {
  undertaking: "undertaking.docx",
};

export function getTemplatePath(documentType: DocumentType): string {
  return path.join(expandHome(env.TEMPLATES_ROOT_DIR), TEMPLATE_FILENAMES[documentType]);
}

export async function getTemplateStatus(documentType: DocumentType): Promise<TemplateStatus> {
  const templatePath = getTemplatePath(documentType);
  try {
    const stats = await stat(templatePath);
    return {
      documentType,
      filename: TEMPLATE_FILENAMES[documentType],
      path: templatePath,
      exists: true,
      lastModifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      documentType,
      filename: TEMPLATE_FILENAMES[documentType],
      path: templatePath,
      exists: false,
      lastModifiedAt: null,
    };
  }
}
