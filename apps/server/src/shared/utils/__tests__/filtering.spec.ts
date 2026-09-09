import { describe, expect, it } from "vitest";

import { buildPrismaFilterWhere, type FilterableColumnDescriptor } from "../filtering.js";

const DESCRIPTORS: Record<string, FilterableColumnDescriptor> = {
  title: { type: "text", prismaPath: ["title"] },
  clientName: { type: "text", prismaPath: ["client", "name"] },
  status: { type: "enum", prismaPath: ["status"] },
  submissionDate: { type: "date", prismaPath: ["submissionDate"], nullable: true },
  assigneeCount: { type: "number", prismaPath: ["assigneeCount"] },
};

describe("buildPrismaFilterWhere", () => {
  it("returns an empty object for no filters", () => {
    expect(buildPrismaFilterWhere([], DESCRIPTORS)).toEqual({});
  });

  it("builds an 'is' equality clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "is", value: "DRAFT" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ status: { equals: "DRAFT" } });
  });

  it("builds an 'is_not' clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "is_not", value: "DRAFT" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ status: { not: "DRAFT" } });
  });

  it("builds a 'contains' clause, case-insensitive", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "title", operator: "contains", value: "road" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ title: { contains: "road", mode: "insensitive" } });
  });

  it("builds a nested relation clause from a multi-segment prismaPath", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "clientName", operator: "contains", value: "Works" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ client: { name: { contains: "Works", mode: "insensitive" } } });
  });

  it("builds a 'has_any_value' clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "submissionDate", operator: "has_any_value" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ submissionDate: { not: null } });
  });

  it("builds 'gt' and 'lt' clauses", () => {
    expect(
      buildPrismaFilterWhere([{ columnKey: "assigneeCount", operator: "gt", value: 2 }], DESCRIPTORS),
    ).toEqual({ assigneeCount: { gt: 2 } });
    expect(
      buildPrismaFilterWhere([{ columnKey: "assigneeCount", operator: "lt", value: 5 }], DESCRIPTORS),
    ).toEqual({ assigneeCount: { lt: 5 } });
  });

  it("builds a 'between' clause from a two-element value array", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "assigneeCount", operator: "between", value: [1, 3] }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ assigneeCount: { gte: 1, lte: 3 } });
  });

  it("builds 'before' and 'after' clauses", () => {
    expect(
      buildPrismaFilterWhere(
        [{ columnKey: "submissionDate", operator: "before", value: "2026-01-01" }],
        DESCRIPTORS,
      ),
    ).toEqual({ submissionDate: { lt: new Date("2026-01-01") } });
    expect(
      buildPrismaFilterWhere(
        [{ columnKey: "submissionDate", operator: "after", value: "2026-01-01" }],
        DESCRIPTORS,
      ),
    ).toEqual({ submissionDate: { gt: new Date("2026-01-01") } });
  });

  it("builds an 'is' clause on a date column as a whole-day range", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "submissionDate", operator: "is", value: "2026-01-01" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({
      submissionDate: { gte: new Date("2026-01-01T00:00:00.000Z"), lt: new Date("2026-01-02T00:00:00.000Z") },
    });
  });

  it("drops a clause with an empty-string value on a value-requiring operator", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "is", value: "" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({});
  });

  it("drops a clause whose operator is not valid for the column's type", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "contains", value: "DRAFT" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({});
  });

  it("drops a 'between' clause whose value is not a two-element array", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "assigneeCount", operator: "between", value: 5 }],
      DESCRIPTORS,
    );
    expect(where).toEqual({});
  });

  it("drops an 'any_of' clause whose value is not an array", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "any_of", value: "DRAFT" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({});
  });

  it("builds an 'any_of' clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "any_of", value: ["DRAFT", "SUBMITTED"] }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ status: { in: ["DRAFT", "SUBMITTED"] } });
  });

  it("ANDs multiple conditions on different columns together", () => {
    const where = buildPrismaFilterWhere(
      [
        { columnKey: "status", operator: "is", value: "DRAFT" },
        { columnKey: "title", operator: "contains", value: "road" },
      ],
      DESCRIPTORS,
    );
    expect(where).toEqual({
      AND: [{ status: { equals: "DRAFT" } }, { title: { contains: "road", mode: "insensitive" } }],
    });
  });

  it("silently drops a condition whose columnKey has no descriptor", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "unknownColumn", operator: "is", value: "x" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({});
  });
});
