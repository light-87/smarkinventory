/**
 * app/api/runs/[runId]/review-xlsx/route.ts — "Download Excel" for an Order
 * Review run: a per-vendor comparison grid (.xlsx). A Route Handler (not a
 * Server Action) since it returns a binary download — mirrors the sibling
 * review-pdf route and app/api/boms/template/route.ts.
 */

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getReviewData } from "@/lib/runs/queries";
import { buildReviewXlsx } from "@/lib/runs/review-xlsx";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const service = createServiceClient();
  const review = await getReviewData(supabase, service, runId);
  if (!review) return NextResponse.json({ error: "That run no longer exists." }, { status: 404 });

  let xlsx: Buffer;
  try {
    xlsx = buildReviewXlsx(review);
  } catch (error) {
    console.error(`[review-xlsx] build failed for run ${runId}:`, error);
    return NextResponse.json({ error: "Could not build the Excel file. Please try again." }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="order-review-${runId.slice(0, 8)}.xlsx"`,
    },
  });
}
