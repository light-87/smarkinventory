import { describe, expect, test } from "bun:test";
import { filterEntries, isVisibleEntry, matchesEntryFilters } from "@/lib/expenses/filter";
import { EMPTY_ENTRY_FILTERS, type EntryFilters, type EntryListItem } from "@/lib/expenses/types";

/**
 * lib/expenses/filter — pure entry-list filtering (plan/tab-expenses.md
 * R2-20 "filter by month/type/category/account/project") + the soft-delete
 * guard. DB-free: lib/expenses/queries.ts is the only caller that touches
 * Supabase; these fixtures stand in for its output shape.
 */

let seq = 0;
function entry(overrides: Partial<EntryListItem> = {}): EntryListItem {
  seq += 1;
  return {
    id: `entry-${seq}`,
    created_at: "2026-07-01T00:00:00+00:00",
    updated_at: null,
    entry_type: "expense",
    amount: 100,
    currency: "INR",
    entry_date: "2026-07-15",
    category: "Materials",
    account_id: "acct-1",
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
    accountName: "Cash box",
    projectName: null,
    ...overrides,
  };
}

describe("isVisibleEntry", () => {
  test("a live entry (deleted_at null) is visible", () => {
    expect(isVisibleEntry(entry())).toBe(true);
  });

  test("a soft-deleted entry (deleted_at set) is never visible", () => {
    expect(isVisibleEntry(entry({ deleted_at: "2026-07-20T00:00:00+00:00" }))).toBe(false);
  });
});

describe("matchesEntryFilters — soft delete always wins", () => {
  test("a soft-deleted row is excluded even when every other filter matches", () => {
    const deleted = entry({ deleted_at: "2026-07-20T00:00:00+00:00", category: "Materials" });
    expect(matchesEntryFilters(deleted, EMPTY_ENTRY_FILTERS)).toBe(false);
    expect(matchesEntryFilters(deleted, { ...EMPTY_ENTRY_FILTERS, category: "Materials" })).toBe(false);
  });
});

describe("matchesEntryFilters — dimensions", () => {
  test("'all' sentinel matches everything on that dimension", () => {
    expect(matchesEntryFilters(entry(), EMPTY_ENTRY_FILTERS)).toBe(true);
  });

  test("month filter matches the YYYY-MM prefix of entry_date", () => {
    const e = entry({ entry_date: "2026-07-15" });
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, month: "2026-07" })).toBe(true);
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, month: "2026-08" })).toBe(false);
  });

  test("type filter", () => {
    const income = entry({ entry_type: "income" });
    expect(matchesEntryFilters(income, { ...EMPTY_ENTRY_FILTERS, type: "income" })).toBe(true);
    expect(matchesEntryFilters(income, { ...EMPTY_ENTRY_FILTERS, type: "expense" })).toBe(false);
  });

  test("category filter", () => {
    const e = entry({ category: "Rent" });
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, category: "Rent" })).toBe(true);
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, category: "Tools" })).toBe(false);
  });

  test("account filter", () => {
    const e = entry({ account_id: "acct-2" });
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, accountId: "acct-2" })).toBe(true);
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, accountId: "acct-1" })).toBe(false);
  });

  test("project filter — null project_id never matches a specific project", () => {
    const e = entry({ project_id: null });
    expect(matchesEntryFilters(e, { ...EMPTY_ENTRY_FILTERS, projectId: "proj-1" })).toBe(false);
  });

  test("filters compose with AND", () => {
    const e = entry({ entry_type: "income", category: "Client payment", project_id: "proj-1" });
    const filters: EntryFilters = { ...EMPTY_ENTRY_FILTERS, type: "income", category: "Client payment" };
    expect(matchesEntryFilters(e, filters)).toBe(true);
    expect(matchesEntryFilters(e, { ...filters, category: "Materials" })).toBe(false);
  });
});

describe("filterEntries", () => {
  test("drops soft-deleted rows and rows that fail any active filter", () => {
    const rows = [
      entry({ id: "a", category: "Materials" }),
      entry({ id: "b", category: "Rent" }),
      entry({ id: "c", category: "Materials", deleted_at: "2026-07-21T00:00:00+00:00" }),
    ];
    const result = filterEntries(rows, { ...EMPTY_ENTRY_FILTERS, category: "Materials" });
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  test("empty filters return every live row", () => {
    const rows = [entry({ id: "a" }), entry({ id: "b" })];
    expect(filterEntries(rows, EMPTY_ENTRY_FILTERS).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
