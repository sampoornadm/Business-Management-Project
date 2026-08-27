import Docxtemplater from "docxtemplater";
import pdfParse from "pdf-parse";
import PizZip from "pizzip";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Best-effort text extraction for content search — same "best effort" philosophy as this
 * codebase's BOQ PDF parsing. Returns null (not throw) for anything it doesn't know how to
 * read, so an unsupported file (e.g. a drawing image) just skips content-embedding and stays
 * searchable by filename/document-type only.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  if (mimeType === "application/pdf") {
    try {
      const data = await pdfParse(buffer);
      return data.text.trim() || null;
    } catch {
      return null;
    }
  }

  if (mimeType === DOCX_MIME_TYPE) {
    try {
      const doc = new Docxtemplater(new PizZip(buffer));
      const text = doc.getFullText().trim();
      return text || null;
    } catch {
      return null;
    }
  }

  return null;
}
