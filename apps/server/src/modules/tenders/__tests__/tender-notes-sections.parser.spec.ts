import { describe, expect, it } from "vitest";

import { parseIiscoNoteSections } from "../tender-notes-sections.parser.js";

// Real `pdftotext -layout` output for the cover section of TE No 1400014147
// ("SELF ADHESSIVE PVC INSULATING TAPE") — not a hand-typed guess. Includes
// the real page-break letterhead block (mid-sentence, splitting the GRN
// note's own text: "...under the Bidder's" / [page break] / "Manual tab."),
// and both verbatim copies of the GRN note (once trailing NIT, once
// trailing ITT) that the parser must dedupe/bound against.
const IISCO_COVER_SECTION_TEXT = `RFQ Item Details
 RFQ Description :
 SELF ADHESSIVE PVC INSULATING TAPE                           360 EASELF ADHESSIVE PVC INSULATING TAPE,GREEN              360
 EA#SELF ADHESSIVE PVC INSULATING TAPE,BLACK              300 EA SELF ADHESSIVE PVC INSULATING TAPE, BLUE                360 EA#SELF
 ADHESSIVE PVC INSULATING TAPE, RED                 360 EAALUMINIUM FOIL TAPE,2IN,30MICRON                                   20
 ROL#INSULATION TAPE,EPR,0.74MM,38MM                                 10 ROLSELF LOCKING CABLE TIE,2.5X75MM
 50 EACABLE TIE,150MM                                                                     50 PAC#CABLE TIE,250MM
 50 PACCABLE TIE,300MM######                           50 PAC##CABLE TIE , 500MM######                    50 PACSLEEVE,4MM,FIBER
 GLASS#####           50 M#SLEEVE,8MM,FIBER GLASS#####           50 MSLEEVE,10MM######                            50 M#CABLE
 TIE,200MM######                           20 PAC#
 Notice Inviting Tender (NIT) :
 RFx Terms & Condition ##1.#THE RATES QUOTED SHOULD BE F.O.R. DESTINATION BASIS. IN CASE THE RATES ARE TO BE QUOTED ON EX-WORKS
 BASIS, THE APPLICABLE FREIGHT FOR EACH ITEM MUST BE INDICATED SEPARATELY IN THE QUOTATION FOR PROPER EVALUATION.#2.#OUR PAYMENT
 TERM IS 100% within 30 days after GRN#3.#PREFERENCES AS PER MSE GUIDELINES AND MAKE IN INDIA POLICY OF GOVT. OF INDIA AND PUBLIC
 PROCUREMENT POLICY AND ANY RELEVANT AMENDMENTS/ CLARIFICATIONS ISSUED BY THE COMPETENT AUTHORITY REGARDING THESE POLICIES SHALL BE
 APPLICABLE. ONLY BIDDERS WHO HAVE CLAIMED ELIGIBILITY AND HAVE UPLOADED RELEVANT DOCUMENTS (UDYAM AADHAAR FOR MSE/ SELF
 DECLARATION OF DOMESTIC VALUE ADDITION ABOVE 50% FROM MANUFACTURER IN MANUFACTURER'S LETTER HEAD, AS PER THE ATTACHED FORMAT, FOR
 PREFERENCE TO CLASS-1 VENDOR AS PER MII POLICY) ARE ONLY ELIGIBLE FOR MSE AND MII PREFERNECE.##4.#QUOTED PRICE MUST BE FIRM TILL
 COMPLETION OF ORDER.##5.#PRICED OFFER MUST REMAIN VALID FOR A PERIOD OF 60 DAYS FROM THE DATE OF OPENING OF PRICE BID.#6.#ALL
 OTHER TERMS & CONDITIONS AS PER SAIL-P1 WHICH MAY BE DOWNLOADED FROM SAIL WEBSITE WWW.SAIL.CO.IN.#7.#EVALUATION OF OFFERS WILL BE
 ON OVERALL BASIS.##8.#ANY TYPE OF CONDITIONAL OFFERS SHALL BE LIABLE FOR REJECTION.#9.#OVERDRAFT INTEREST FOR DELAYING PAYMENT
 WILL NOT BE ACCEPTABLE.##10.#BIDDERS MUST CONFIRM ACCEPTANCE OF FORMAT FOR UNDERTAKING AS PER THE ATTACHED FORMAT.#11.#ANY
 DEVIATION SHOULD BE CLEARLY MENTIONED IN THE OFFER.#12.# BIDDERS MUST ENSURE THAT ALL DOCUMENTS SPECIFIED IN THE TENDER ARE
 SUBMITTED ALONG WITH THEIR BIDS, FAILING WHICH THE BID IS LIABLE FOR REJECTION.#Note: SAIL ISP shall issue the Goods Receipt and
 Acceptance Note (GRN) and auto generated mail shall be sent for the same. Sellers are required to submit documents (including
 digitally signed invoices) on the Online Bill Submission system (https://srm.sailisp.co.in/) of the SRM Portal of the Buyer,
 against the corresponding GRN, for release of payment.##The detailed user manual for online submission of bills is available on
 the SRM Portal at the following link:https://srm.sailisp.co.in/irj/go/km/docs/documents/Sail1/index.html , under the Bidder's



                                                                                                                                     Page 3 / *
                                                                                                      IISCO STEEL PLANT
                                              BID INVITATION                                          ISP GST : 19AAACS7062F6Z6
                             (Kindly scrutinize the dates carefully for timely response submission)   Corporate Identity No:
                                                                                                       L27109DL1973GOI006454
TE No:        1400014147                  TE Date:    09.09.2026            Contracting Agency:        ISP MATERIAL MANAGEMENT DEPARTMENT
RFQ Title:    MJ/C04/2026/4347_SELF       Amendment No:                           Amendment Date:
              ADHESSIVE PVC INSU


Manual tab.##The detailed Item Description is available under the "Item Text" section in the "Notes & Attachments" tab.####For any
other queries, please write to Moumita.Gantait@mjunction.in.##
Instructions to Tenderers (ITT) :
1. Items will be jointly inspected by indenting department and inspection department of MM.#2. Inspection will be done at the
Central Store of ISP.#3. Warranty certificate to be provided with material.##4. Delivery Schedule: 105 days from PO placement.##5.
Order on one or more than one parties will be placed on the basis of L1 quotation and, if required, negotiation will be held with
L1 tenderer only. However, all the tenderers may be required to explain/justify the basis of their quoted prices as and when asked
for. In case, any tenderers fails to justify his quoted price or refuses to co-operate in this regard, they will not be considered
for participating in the re-tendering if order/ contract is not finalized from the present tender.#6. Bidders must ensure that all
documents specified in the tender are submitted along with their bids, failing which the bid is liable for rejection. #7. SAIL-ISP
reserves the right to summarily reject bids with missing/ incomplete documentation without seeking further clarification.
stage. Submission of fresh stand-alone documents shall not be entertained.##Note: SAIL ISP shall issue the Goods Receipt and
Acceptance Note (GRN) and auto generated mail shall be sent for the same. Sellers are required to submit documents (including
digitally signed invoices) on the Online Bill Submission system (https://srm.sailisp.co.in/) of the SRM Portal of the Buyer,
against the corresponding GRN, for release of payment.##The detailed user manual for online submission of bills is available on
the SRM Portal at the following link:https://srm.sailisp.co.in/irj/go/km/docs/documents/Sail1/index.html , under the Bidder's
Manual tab.###The detailed Item Description is available under the "Item Text" section in the "Notes & Attachments" tab.####

 Sl No                     Item Code                      Qty                              UoM                    Expected Delivery
                                                                                                                  Date
   1                       51810101300348                     360.000           EA                                31.01.2027`;

describe("parseIiscoNoteSections", () => {
  it("returns null for text with neither NIT nor ITT headings", () => {
    expect(parseIiscoNoteSections("This is a plain Word document with no tender sections at all.")).toBeNull();
  });

  it("extracts RFQ Description, NIT, Note (GRN), and ITT as separate sections in a fixed order", () => {
    const sections = parseIiscoNoteSections(IISCO_COVER_SECTION_TEXT);

    expect(sections).not.toBeNull();
    expect(sections!.map((s) => s.key)).toEqual(["rfqDescription", "nit", "itt", "grnNote"]);
  });

  it("dedupes the GRN note — appears once overall, not glued onto NIT's or ITT's tail", () => {
    const sections = parseIiscoNoteSections(IISCO_COVER_SECTION_TEXT)!;
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    const GRN_PHRASE = "Note: SAIL ISP shall issue";

    expect(byKey.nit!.text).not.toContain(GRN_PHRASE);
    expect(byKey.itt!.text).not.toContain(GRN_PHRASE);
    expect(byKey.grnNote!.text).toContain(GRN_PHRASE);

    const occurrences = sections.filter((s) => s.text.includes(GRN_PHRASE)).length;
    expect(occurrences).toBe(1);
  });

  it("strips the page-break letterhead (including its mid-sentence split) from every section", () => {
    const sections = parseIiscoNoteSections(IISCO_COVER_SECTION_TEXT)!;
    for (const section of sections) {
      expect(section.text).not.toMatch(/Page \d+ \/|IISCO STEEL PLANT|BID INVITATION|RFQ Title\s*:/);
    }
    // The letterhead split the GRN note's own sentence in two — proves the
    // halves were stitched back together, not just that the middle vanished.
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    expect(byKey.grnNote!.text).toContain("under the Bidder's");
    expect(byKey.grnNote!.text).toContain("Manual tab.");
  });

  it("captures ITT's warranty and delivery points verbatim", () => {
    const sections = parseIiscoNoteSections(IISCO_COVER_SECTION_TEXT)!;
    const itt = sections.find((s) => s.key === "itt")!;

    expect(itt.text).toContain("3. Warranty certificate to be provided with material.");
    expect(itt.text).toContain("4. Delivery Schedule: 105 days from PO placement.");
  });

  it("still returns a single-element array for a partial document (ITT only)", () => {
    const text = `Instructions to Tenderers (ITT) :
1. Deliver within 120 days.

 Sl No                     Item Code                      Qty                              UoM                    Expected Delivery
                                                                                                                  Date`;

    const sections = parseIiscoNoteSections(text);

    expect(sections).toHaveLength(1);
    expect(sections![0]).toEqual({
      key: "itt",
      heading: "Instructions to Tenderers (ITT)",
      text: "1. Deliver within 120 days.",
    });
  });
});
