/**
 * lib/supabase/select-all.ts — read a whole table past PostgREST's row cap.
 *
 * PostgREST refuses to return more rows than `max_rows` in a single response
 * (`supabase/config.toml` sets 1000 locally; Supabase hosted defaults to the
 * same). It does not error when it truncates — it just returns the first page,
 * so an unpaginated `.select("*")` on a table with more rows than that silently
 * returns half the data and every count computed from it is quietly wrong.
 *
 * That bit us the moment the real stock list landed: ~2000 parts against a
 * 1000-row cap meant the Inventory table, its facet value lists and the CSV
 * export would all have shown exactly half the catalog with no error anywhere.
 * `.limit(5000)` does NOT help — `max_rows` clamps it.
 *
 * The fix is to page with `.range()` until a short page comes back. That loop
 * already existed in `lib/import/existing-parts.ts` for the importer's identity
 * read; this is the same logic, lifted so the app's read paths can share it.
 *
 * **Always give the query a stable `.order()`.** Range paging over an unordered
 * result is undefined — Postgres may return rows in a different order per page,
 * which duplicates some and drops others.
 */

/** PostgREST's own default page size, and the cap we page around. */
export const SELECT_PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Runs `page(from, to)` repeatedly until it returns a short page, and returns
 * every row. Throws on the first error rather than returning a partial result —
 * a truncated catalog is worse than a visible failure.
 *
 * @example
 * const parts = await selectAllRows((from, to) =>
 *   supabase.from(TABLES.parts).select("*").order("internal_pid").range(from, to),
 * );
 */
export async function selectAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = SELECT_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}
