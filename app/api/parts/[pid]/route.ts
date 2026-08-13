/**
 * app/api/parts/[pid]/route.ts — one part's detail, on its own.
 *
 * The Inventory drawer used to be driven by a `?pid=` search param, which means
 * opening it re-rendered the whole Inventory route server-side. Measured on
 * production, 2026-08-13:
 *
 *   /inventory                    1,797 KB
 *   /inventory?pid=SMK-000001     1,805 KB   ← the drawer costs 8 KB
 *   /part/SMK-000431                 44 KB
 *
 * So clicking a row downloaded the entire catalog a second time to show a panel
 * worth a few kilobytes, and on the client's office machines that was a
 * multi-second wait every time anyone looked at a part. That wait is the reason
 * they asked for more columns on the main grid — they were routing around it.
 *
 * This endpoint serves the panel alone. Auth and RLS are unchanged: it calls the
 * same `getPartDetailData`, which builds a per-request client from the caller's
 * own cookies, so it can return nothing the page could not.
 */

import { NextResponse } from "next/server";
import { getPartDetailData } from "@/lib/part-events/query";

export async function GET(_request: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const result = await getPartDetailData(decodeURIComponent(pid));
  // The shape is a discriminated union the client already understands; a failed
  // lookup is a value, not an HTTP error, so the drawer can say WHY.
  return NextResponse.json(result, { status: result.ok ? 200 : result.reason === "unauthorized" ? 401 : 200 });
}
