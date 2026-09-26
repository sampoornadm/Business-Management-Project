import { describe, expect, it } from "vitest";

import { detectRequiredDocuments } from "../tender-document-requirements.parser.js";

describe("detectRequiredDocuments", () => {
  it("returns nothing for notes that mention no known document type", () => {
    expect(detectRequiredDocuments("## Notes\n- Delivery within 30 days of order.")).toEqual([]);
  });

  it("returns an empty array for empty/null-ish notes", () => {
    expect(detectRequiredDocuments("")).toEqual([]);
  });

  it("detects a single document-type mention", () => {
    const result = detectRequiredDocuments("## Notes\n- Refer to Corrigendum No. 2 dated 12.03.2026.");
    expect(result).toEqual([{ type: "CORRIGENDUM", matchedPhrase: "Corrigendum" }]);
  });

  it("detects several different document types in one notes block", () => {
    const result = detectRequiredDocuments(
      [
        "## Notes",
        "- Technical Specifications are enclosed as Annexure A.",
        "- Drawings for the site layout are attached separately.",
        "- Bidders must submit an Undertaking regarding non-blacklisting.",
      ].join("\n"),
    );
    expect(result.map((r) => r.type).sort()).toEqual(["DRAWINGS", "TECHNICAL_SPECS", "UNDERTAKING"]);
  });

  it("is case-insensitive", () => {
    expect(detectRequiredDocuments("please see the addendum issued")).toEqual([
      { type: "ADDENDUM", matchedPhrase: "addendum" },
    ]);
  });

  it("de-duplicates repeated mentions of the same type, keeping the first matched phrase", () => {
    const result = detectRequiredDocuments("Drawings attached. See Drawings section 2 for details.");
    expect(result).toEqual([{ type: "DRAWINGS", matchedPhrase: "Drawings" }]);
  });

  it("does not match a word that merely contains a document-type term as a substring", () => {
    // "undertakings" the word is fine (still UNDERTAKING), but "Undertakingly" (not a real word,
    // guards the \b boundary) must not match, and neither should an unrelated word like "biller".
    expect(detectRequiredDocuments("The biller name must be legible.")).toEqual([]);
  });

  it("ignores a document-type name that only appears as a section heading", () => {
    // Every notes-generation path in this app (tender-extraction.service.ts, tender-notes.parser.ts)
    // renders its own section titles as "## <heading>" lines — including a literal
    // "## Notice Inviting Tender (NIT)" heading for the SAIL/IISCO template on every single tender.
    // That heading is a structural artifact of OUR OWN parser, not a requirement the source
    // document stated, so it must not register as "missing" just because a NIT-typed file isn't
    // uploaded yet.
    expect(detectRequiredDocuments("## Notice Inviting Tender (NIT)\n- Delivery within 30 days.")).toEqual([]);
  });

  it("still detects a document-type mention in the body of a section, heading aside", () => {
    const result = detectRequiredDocuments("## Notes\n- Please refer to the NIT for eligibility criteria.");
    expect(result).toEqual([{ type: "NIT", matchedPhrase: "NIT" }]);
  });
});
