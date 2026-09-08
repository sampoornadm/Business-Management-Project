import { describe, expect, it } from "vitest";

import { exportTableToCsv, type ExportableTable } from "../table-export.js";

describe("exportTableToCsv", () => {
  const table: ExportableTable = {
    title: "Test",
    columns: [
      { key: "name", header: "Name" },
      { key: "note", header: "Note" },
    ],
    rows: [
      { name: "Alpha", note: "plain" },
      { name: "Beta, LLC", note: 'has "quotes" and a comma' },
    ],
  };

  it("writes a header row followed by one row per data row", () => {
    const csv = exportTableToCsv(table).toString("utf-8");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Note");
    expect(lines[1]).toBe("Alpha,plain");
  });

  it("quotes and escapes a field containing a comma or double quote", () => {
    const csv = exportTableToCsv(table).toString("utf-8");
    const lines = csv.split("\r\n");
    expect(lines[2]).toBe('"Beta, LLC","has ""quotes"" and a comma"');
  });
});
