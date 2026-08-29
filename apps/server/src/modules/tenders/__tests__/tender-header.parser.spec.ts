import { describe, expect, it } from "vitest";

import { parseIiscoHeaderFields } from "../tender-header.parser.js";

// The real raw-text output of the actual `pdftotext` CLI (not a hand-typed
// guess) for a real IISCO/SAIL "BID INVITATION" sample — TE No 1400013427,
// "FKM O Ring" — captured via `pdftotext sample.pdf -`. Pinning the real
// extractor's real output here (rather than a fixture that only mimics what
// we assume it produces) is the fix for the regression that slipped through
// when this codebase moved off pdf-parse: the old fixture mimicked
// pdf-parse's output byte-for-byte, so the parser's own tests kept passing
// even after pdftotext started producing a completely different shape.
const FULL_DOCUMENT_TEXT = `BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)

TE No:
RFQ Title:

1400013427
MJ/C07/2026/3465

TE Date:
30.05.2026
Amendment No:

Contracting Agency:
Amendment Date:

IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
ISP MATERIAL MANAGEMENT DEPARTMENT

Note:- Anti-bribery Undertaking:
By participating in this tender, the suppliers / Vendors/Contractors are deemed to have undertaken that they shall not give or
take any financial or non-financial bribe, to or from anyone during the tender or during the execution of the contract thereafter
and if they notice any such incident happening , they shall report it to SAIL Vigilance.

Pur Grp

Case File

Dealing Officer

E-mail

PACKAG, RUBBER MATL

MJ/C07/2026/3465

Avishek Mozumder

Mozumder.Avishek@mjunction.
in

Mobile No

Tender Header Information

Page i / 3

BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)

TE No:
RFQ Title:

1400013427
MJ/C07/2026/3465

Bid Type
Type
Price Bid Option
RA Applicable
Evaluation Criteria
Bid Submission Deadline
Sources for Supply / Execution

TE Date:
30.05.2026
Amendment No:

Two Part Bid Response
e-Procurement
e-Procurement
No
Overall
06.06.2026 15:00:00 Hrs
1

Contracting Agency:
Amendment Date:

Quotation validity in days

IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
ISP MATERIAL MANAGEMENT DEPARTMENT

60

Page 2 / 3

BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)

TE No:
RFQ Title:

1400013427

TE Date:
30.05.2026
Amendment No:

MJ/C07/2026/3465

Contracting Agency:
Amendment Date:

IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
ISP MATERIAL MANAGEMENT DEPARTMENT

RFQ Item Details
RFQ Description :
AUTO COUPLER O RING 42 MM
Instructions to Tenderers (ITT) :
Material Test Certificate (MTC) from Indian Rubber Materials Research Institute OR any NABL accredited OR Govt. authorized Lab to
accompany the supply.Guarantee Certificate for fitment and Performance in 200 deg Celsius Temperature at 25 Bar pressure, to
accompany supply.For any visible defects or dimensional deviation, the Items will be rejected and Party to supply replacement
without any additional cost.O-Rings must be manufactured in accordance to ISO-3601.#Acceptable Shore Hardness Range is 75 to 90
Shore A.#200 pcs of O-Rings must be supplied in First Lot and after Performance check and acceptance rest quantity to be
delivered.Joint Inspection of the Items will be done by Inspection Wing of ISP & BOF Mechanical on receipt of the Items at ISP
Store.

Sl No

Item Code

Qty

UoM

1
71804001603937
1,500.000
EA
Material Long Description O-RING MATERIAL : FKM , SHORE HARDNESS : 80 AS PER ASTM D2240 DIAMETER,
:
INNER : 42 MM SIZE: OD 58 MM, CORD DIAMETER: 8 MM, FOR AUTO COUPLING
SYSTEM OF STEEL TEEMING LADLE OF BOF CONVERTER
Item Additional
Description:

Expected Delivery
Date
28.07.2026

***************This is an electronically generated RFX requires no signature***************

Page 3 / 3
`;

describe("parseIiscoHeaderFields", () => {
  it("extracts every field correctly from real pdftotext output", () => {
    const fields = parseIiscoHeaderFields(FULL_DOCUMENT_TEXT);

    expect(fields).not.toBeNull();
    expect(fields!.tenderNumber).toBe("1400013427");
    expect(fields!.title).toBe("MJ/C07/2026/3465");
    expect(fields!.openingDate).toBe("2026-05-30");
    expect(fields!.department).toBe("ISP MATERIAL MANAGEMENT DEPARTMENT");
    expect(fields!.submissionDate).toBe("2026-06-06T15:00:00");
    expect(fields!.validityPeriodDays).toBe(60);
    expect(fields!.type).toBe("Two Part Bid Response");
    expect(fields!.clientName).toBe("IISCO STEEL PLANT");
    expect(fields!.dealingOfficerName).toBe("Avishek Mozumder");
    expect(fields!.dealingOfficerEmail).toBe("Mozumder.Avishek@mjunction.in");
    expect(fields!.description).toBe("AUTO COUPLER O RING 42 MM");
    expect(fields!.remarks).toContain("Material Test Certificate (MTC) from Indian Rubber Materials Research Institute");
  });

  it("returns null for a document that doesn't match the template", () => {
    const fields = parseIiscoHeaderFields("This is a plain Word document with no tender fields at all.");

    expect(fields).toBeNull();
  });

  it("omits submissionDate/openingDate when the source uses the all-zero placeholder date", () => {
    const text = FULL_DOCUMENT_TEXT.replace("TE Date:\n30.05.2026", "TE Date:\n00.00.0000").replace(
      "06.06.2026 15:00:00 Hrs",
      "00.00.0000 00:00:00 Hrs",
    );

    const fields = parseIiscoHeaderFields(text);

    expect(fields!.openingDate).toBeUndefined();
    expect(fields!.submissionDate).toBeUndefined();
  });

  it("still extracts the dealing officer when Pur Grp/Case File are blank", () => {
    const text = FULL_DOCUMENT_TEXT.replace(
      "PACKAG, RUBBER MATL\n\nMJ/C07/2026/3465\n\nAvishek Mozumder",
      "Avishek Mozumder",
    );

    const fields = parseIiscoHeaderFields(text);

    expect(fields!.dealingOfficerName).toBe("Avishek Mozumder");
    expect(fields!.dealingOfficerEmail).toBe("Mozumder.Avishek@mjunction.in");
  });
});
