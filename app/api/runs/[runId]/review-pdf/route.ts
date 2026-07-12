/**
 * app/api/runs/[runId]/review-pdf/route.ts — "Save as PDF cart" download
 * (plan/tab-order-review.md §2/§6 footer bar). A Route Handler (not a Server
 * Action) since it returns a binary file download — mirrors
 * app/api/boms/template/route.ts / app/api/labels/print-sheet/route.ts.
 */

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getReviewData } from "@/lib/runs/queries";
import { buildReviewPdf } from "@/lib/runs/review-pdf";

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

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildReviewPdf(review);
  } catch (error) {
    // Never surface a raw stack as the download — return a clean JSON error so
    // a future font/encoding gap degrades gracefully instead of a 500 page.
    console.error(`[review-pdf] build failed for run ${runId}:`, error);
    return NextResponse.json({ error: "Could not build the PDF. Please try again." }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="order-review-${runId.slice(0, 8)}.pdf"`,
    },
  });
}
