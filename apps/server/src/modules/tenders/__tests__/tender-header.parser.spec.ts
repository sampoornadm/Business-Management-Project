import { describe, expect, it } from "vitest";

import { parseIiscoHeaderFields } from "../tender-header.parser.js";

// Mirrors pdf-parse's real raw-text output for the IISCO/SAIL "BID
// INVITATION" template (verified directly against examples/BID1400013656.PDF
// and examples/RFx 1400012649.PDF) — values sit immediately before their own
// labels with no separator, e.g. "Contracting Agency:30.06.2026TE Date:".
const FULL_DOCUMENT_TEXT = `IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)
ISP MATERIAL MANAGEMENT DEPARTMENT
Amendment Date:Amendment No:
Contracting Agency:30.06.2026TE Date:
MJ/C06/2026/3776-FLANGE
SLIP
1400013656
RFQ Title:
TE No:
Note:- Anti-bribery Undertaking:
Some boilerplate legal text here.
Pur GrpCase FileDealing OfficerE-mailMobile No
METAL PIPESMJ/C06/2026/3776-
FLANGE SLIP
 Paramita Sinhaparamita.sinha@mjunction.in
Tender Header Information
      Page i / *
1Sources for Supply / Execution
07.07.2026 15:00:00 HrsBid Submission Deadline
OverallEvaluation Criteria
NoRA Applicable
e-ProcurementPrice Bid Option
e-ProcurementType
60Quotation validity in daysTwo Part Bid ResponseBid Type
RFQ Item Details
RFQ Description :
Procurement of FLANGE SLIP
Instructions to Tenderers (ITT) :
Instructions to bidder:#1. Delivery to be done within 120 days of PO placement.
Sl No Item Code Qty UoM Expected Delivery
Date
 1 71313000100594 30.000 EA 30.10.2026`;

describe("parseIiscoHeaderFields", () => {
  it("extracts every field correctly from the real jumbled template text", () => {
    const fields = parseIiscoHeaderFields(FULL_DOCUMENT_TEXT);

    expect(fields).not.toBeNull();
    expect(fields!.tenderNumber).toBe("1400013656");
    expect(fields!.title).toBe("MJ/C06/2026/3776-FLANGE SLIP");
    expect(fields!.openingDate).toBe("2026-06-30");
    expect(fields!.department).toBe("ISP MATERIAL MANAGEMENT DEPARTMENT");
    expect(fields!.submissionDate).toBe("2026-07-07T15:00:00");
    expect(fields!.validityPeriodDays).toBe(60);
    expect(fields!.type).toBe("Two Part Bid Response");
    expect(fields!.clientName).toBe("IISCO STEEL PLANT");
    expect(fields!.dealingOfficerName).toBe("Paramita Sinha");
    expect(fields!.dealingOfficerEmail).toBe("paramita.sinha@mjunction.in");
    expect(fields!.description).toBe("Procurement of FLANGE SLIP");
    expect(fields!.remarks).toContain("Delivery to be done within 120 days");
  });

  it("returns null for a document that doesn't match the template", () => {
    const fields = parseIiscoHeaderFields("This is a plain Word document with no tender fields at all.");

    expect(fields).toBeNull();
  });

  it("omits submissionDate/openingDate when the source uses the all-zero placeholder date", () => {
    const text = FULL_DOCUMENT_TEXT
      .replace("30.06.2026TE Date:", "00.00.0000TE Date:")
      .replace("07.07.2026 15:00:00 HrsBid Submission Deadline", "00.00.0000 00:00:00 HrsBid Submission Deadline");

    const fields = parseIiscoHeaderFields(text);

    expect(fields!.openingDate).toBeUndefined();
    expect(fields!.submissionDate).toBeUndefined();
  });

  it("gracefully omits the dealing officer when the name has more parts than the e-mail local part", () => {
    // Real example (examples/RFx 1400012566.PDF): "Niladri Shekhar Dey" /
    // "niladri.dey@..." — the email drops the middle name, so there's no
    // exact reversible split; the parser must not guess a wrong boundary.
    const text = FULL_DOCUMENT_TEXT.replace(
      " Paramita Sinhaparamita.sinha@mjunction.in",
      " Niladri Shekhar Deyniladri.dey@mjunction.in",
    );

    const fields = parseIiscoHeaderFields(text);

    expect(fields!.dealingOfficerName).toBeUndefined();
    expect(fields!.dealingOfficerEmail).toBeUndefined();
  });
});
