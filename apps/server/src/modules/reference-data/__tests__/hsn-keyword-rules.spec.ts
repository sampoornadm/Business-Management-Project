import { describe, expect, it } from "vitest";

import { matchHsnByKeyword } from "../hsn-keyword-rules.js";

describe("matchHsnByKeyword", () => {
  it("matches a steel pipe-fitting description to 7307", () => {
    const result = matchHsnByKeyword(
      "TEE MATERIAL : MILD STEEL : GALVANIZED MATERIAL SPEC : IS:1239,PART-II ,1969 SIZE : 15MM TEE FEMALE,MEDIUM QUALITY",
    );
    expect(result).toEqual({
      code: "7307",
      description: "TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL",
    });
  });

  it("matches an M.S.-abbreviated fitting via the IS:1239 standard reference", () => {
    const result = matchHsnByKeyword(
      "M.S.BARREL NIPPLE 15 MM X 60 MM (LENGTH MIN) X3.2 MM WALL THICKNESS,AS PER IS:1239 PT.II/1992",
    );
    expect(result?.code).toBe("7307");
  });

  it("returns null for a fitting word with no iron/steel signal", () => {
    expect(matchHsnByKeyword("PLASTIC SOCKET FOR ELECTRICAL WIRING")).toBeNull();
  });

  it("returns null for a steel item that isn't a pipe fitting", () => {
    expect(matchHsnByKeyword("MILD STEEL FLAT BAR 50X6MM")).toBeNull();
  });

  it("matches a disc spring washer to 7320, not 7318's fastener spring washers", () => {
    const result = matchHsnByKeyword(
      "WASHER TYPE : DISC SPRING MATERIAL : : SPRING STEEL MATERIAL SPEC : 51CRV4 COATING : BLACK PHOSPHATE",
    );
    expect(result).toEqual({
      code: "7320",
      description: "SPRINGS AND LEAVES FOR SPRINGS, OF IRON OR STEEL",
    });
  });

  it("matches a bearing preload spring to 7320", () => {
    const result = matchHsnByKeyword(
      'BEARING PRELOAD SPRING, TYPE: K, NON SLOTTED / CUP SPRING, SIZE: 25.7 X14.3 X 0.4, MATERIAL: SPRING STEEL',
    );
    expect(result?.code).toBe("7320");
  });

  it("matches a Belleville washer to 7320 by name alone", () => {
    expect(matchHsnByKeyword("BELLEVILLE WASHER, SPRING STEEL, 20MM")?.code).toBe("7320");
  });

  it("does not misclassify a plain (non-spring) steel washer as 7320", () => {
    expect(matchHsnByKeyword("MILD STEEL WASHER, BLACK PHOSPHATE FINISH, 31MM DIA (M30)")).toBeNull();
  });
});
