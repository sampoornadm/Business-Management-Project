import type { ContactDto } from "@bmp/types";
import { describe, expect, it } from "vitest";

import { editDistance, filterContacts } from "./contact-search";

function contact(overrides: Partial<ContactDto>): ContactDto {
  return {
    id: overrides.name ?? "id",
    name: "",
    department: null,
    designation: null,
    notes: null,
    isPrimary: false,
    phones: [],
    emails: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Real names/designations/departments, sourced from public SAIL IISCO Steel
// Plant information — used because Indian names are exactly the case
// fuzzysort's plain subsequence matching fails on (see editDistance below).
const contacts: ContactDto[] = [
  contact({ name: "Jibanmoy Roy", department: "Town Services & CSR", designation: "Chief General Manager" }),
  contact({ name: "Sanjay Gajbhiye", department: "Personnel & Administration", designation: "General Manager" }),
  contact({ name: "Debasish Chakraborty", department: "Coke Ovens", designation: "Assistant General Manager" }),
  contact({
    name: "Ramaswamy Krishnamurthy",
    department: "Blast Furnace",
    designation: "Additional General Manager",
  }),
  contact({ name: "Aparajita Bhattacharya", department: "Safety", designation: "Senior Manager" }),
  contact({ name: "Surajit Mishra", department: "Plant Administration", designation: "Director Incharge" }),
];

function names(results: ContactDto[]): string[] {
  return results.map((c) => c.name);
}

describe("editDistance", () => {
  it("treats an adjacent transposition as a single edit", () => {
    expect(editDistance("cheif", "chief")).toBe(1);
  });

  it("counts a plain substitution as one edit", () => {
    expect(editDistance("gajbhiya", "gajbhiye")).toBe(1);
  });

  it("is zero for identical strings", () => {
    expect(editDistance("manager", "manager")).toBe(0);
  });
});

describe("filterContacts", () => {
  it("returns everything for an empty query", () => {
    expect(filterContacts("", contacts)).toHaveLength(contacts.length);
  });

  it("matches exact and reordered names via fuzzysort", () => {
    expect(names(filterContacts("Jibanmoy Roy", contacts))).toContain("Jibanmoy Roy");
    expect(names(filterContacts("roy jibanmoy", contacts))).toContain("Jibanmoy Roy");
  });

  it("still matches common Indian-name transliteration variants fuzzysort alone misses", () => {
    // Chakraborty/Chakravarty, Krishnamurthy/Krishnamurti, Bhattacharya/Bhattacharjee
    // are standard alternate transliterations, not typos — a plain subsequence
    // matcher returns nothing for these (verified: fuzzysort.single() -> null).
    expect(names(filterContacts("chakravarty", contacts))).toContain("Debasish Chakraborty");
    expect(names(filterContacts("krishnamurti", contacts))).toContain("Ramaswamy Krishnamurthy");
    expect(names(filterContacts("bhattacharjee", contacts))).toContain("Aparajita Bhattacharya");
  });

  it("tolerates ordinary single-letter typos in a name", () => {
    expect(names(filterContacts("jibanmay roy", contacts))).toContain("Jibanmoy Roy");
    expect(names(filterContacts("gajbhiya", contacts))).toContain("Sanjay Gajbhiye");
  });

  it("tolerates a transposition typo in a designation", () => {
    expect(names(filterContacts("cheif genral manager", contacts))).toContain("Jibanmoy Roy");
  });

  it("tolerates a typo in a department", () => {
    expect(names(filterContacts("toen servces csr", contacts))).toContain("Jibanmoy Roy");
  });

  it("matches abbreviated designations fuzzysort already handled", () => {
    expect(names(filterContacts("addl gm", contacts))).toContain("Ramaswamy Krishnamurthy");
  });

  it("does not fuzzy-match unrelated short query words", () => {
    // "csr" resolves as a real substring/acronym match, not noise.
    expect(names(filterContacts("csr", contacts))).toContain("Jibanmoy Roy");
    expect(filterContacts("xyz nonexistent query", contacts)).toHaveLength(0);
  });
});
