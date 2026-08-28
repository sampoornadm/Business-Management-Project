import mammoth from "mammoth";

import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { extractPdfText } from "../../shared/utils/pdf-text.js";

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Returns the FULL extracted text, untruncated — a multi-page document's
// item table can run well past any reasonable prompt-size cutoff (verified:
// a 9-page, 13-item document's last item fell past a 12,000-char truncation
// point, silently dropping its description). Truncation for the LLM prompt
// is the caller's concern, applied only to what it sends the model — the
// deterministic item parser always sees everything.
export async function extractDocumentText(buffer: Buffer, mimeType: string): Promise<string> {
  let text: string;
  if (mimeType === "application/pdf") {
    text = await extractPdfText(buffer);
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    text = await extractDocxText(buffer);
  } else {
    throw new BadRequestError(
      "Unsupported file type for tender extraction. Upload a PDF or Word (.docx) document.",
    );
  }

  return text.trim();
}
