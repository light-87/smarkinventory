import { describe, expect, test } from "bun:test";
import { entryToExportRow, sanitizeForSpreadsheet, toCsv, toCsvValue } from "@/lib/expenses/csv";
import type { EntryListItem } from "@/lib/expenses/types";

/**
 * Finding #6 — CSV/formula (spreadsheet) injection (CWE-1236). A free-text
 * field (vendor/note/category/etc.) starting with `=`/`+`/`-`/`@` (or a
 * leading tab/CR) must never reach the exported CSV or xlsx cell unescaped —
 * Excel/Sheets can interpret it as a formula on open. `entryToExportRow` is
 * asserted directly since it feeds BOTH the CSV writer (via `toCsvValue`)
 * and the xlsx route's `aoa_to_sheet` call (app/(app)/expenses/export/route.ts),
 * which never goes through `toCsvValue` at all.
 */

const baseEntry: EntryListItem = {
  id: "e1",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: null,
  entry_type: "expense",
  amount: 100,
  currency: "INR",
  entry_date: "2026-07-01",
  category: "Other",
  account_id: null,
  vendor: null,
  gstin: null,
  tax_amount: null,
  project_id: null,
  note: null,
  attachment_url: null,
  is_draft: false,
  source_order_id: null,
  created_by: null,
  deleted_at: null,
  accountName: null,
  projectName: null,
};

describe("sanitizeForSpreadsheet — finding #6 CSV/formula injection", () => {
  test.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+1+1", "'+1+1"],
    ["-cmd|' /C calc'!A0", "'-cmd|' /C calc'!A0"],
    ["@SUM(1+1)", "'@SUM(1+1)"],
    ["\tsneaky", "'\tsneaky"],
    ["\rsneaky", "'\rsneaky"],
  ])("prefixes a value starting with a dangerous character: %s", (input, expected) => {
    expect(sanitizeForSpreadsheet(input)).toBe(expected);
  });

  test("leaves an ordinary value untouched", () => {
    expect(sanitizeForSpreadsheet("Digikey")).toBe("Digikey");
    expect(sanitizeForSpreadsheet("")).toBe("");
  });

  test("a negative-looking legitimate value still gets the safety prefix (defense over cosmetics)", () => {
    expect(sanitizeForSpreadsheet("-100 refund")).toBe("'-100 refund");
  });
});

describe("entryToExportRow — every free-text column is sanitized (feeds both CSV and xlsx)", () => {
  test("vendor/category/note/project/gstin/attachment starting with '=' are all prefixed", () => {
    const entry: EntryListItem = {
      ...baseEntry,
      category: "Other",
      vendor: "=HYPERLINK(\"http://evil\")",
      note: "=1+1",
      projectName: "=cmd",
      gstin: "=A1",
      attachment_url: "=B1",
    };
    const row = entryToExportRow(entry);
    // [date, type, amount, category, account, vendor, project, gstin, tax, note, draft, attachment]
    expect(row[5]).toBe('\'=HYPERLINK("http://evil")');
    expect(row[6]).toBe("'=cmd");
    expect(row[7]).toBe("'=A1");
    expect(row[9]).toBe("'=1+1");
    expect(row[11]).toBe("'=B1");
  });

  test("an ordinary entry round-trips unchanged", () => {
    const row = entryToExportRow({ ...baseEntry, vendor: "Digikey", note: "Resistors" });
    expect(row[5]).toBe("Digikey");
    expect(row[9]).toBe("Resistors");
  });
});

describe("toCsvValue / toCsv — CSV path also sanitizes raw values directly", () => {
  test("a raw formula-like string value is prefixed before quoting", () => {
    expect(toCsvValue("=cmd")).toBe("'=cmd");
  });

  test("a formula-like value that also needs RFC 4180 quoting gets both", () => {
    expect(toCsvValue("=A1,B1")).toBe('"\'=A1,B1"');
  });

  test("toCsv sanitizes every cell in every row", () => {
    const csv = toCsv([["Vendor"], ["=SUM(1,2)"]]);
    expect(csv).toContain("'=SUM(1,2)");
    expect(csv).not.toContain("\n=SUM"); // never lands unescaped
  });
});
