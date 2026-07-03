import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractReceipt } from "@/lib/ai/extract";

interface ExtractReceiptBody {
  fileText?: unknown;
  imageBase64?: unknown;
  mediaType?: unknown;
}

/**
 * POST /api/ai/extract-receipt — plan/TESTING.md §2 "receipt-extraction
 * endpoint (mocked Claude)". Body: `{ fileText?: string; imageBase64?:
 * string; mediaType?: string }` (at least one of `fileText`/`imageBase64`).
 *
 * Runs under the caller's own session (any signed-in role may extract — the
 * §2 role matrix gates Cart/Orders write access, not this read-only
 * proposal endpoint; the real gate is that nothing here writes
 * `smark_orders.receipt_extracted` — cart-orders' own Server Action does
 * that, AFTER the user confirms the proposed lines, per §20 risk #3).
 * Returns `{ lines, total }` — never partially written to the DB from here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: ExtractReceiptBody;
  try {
    body = (await request.json()) as ExtractReceiptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fileText = typeof body.fileText === "string" ? body.fileText : undefined;
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : undefined;
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : undefined;

  if (!fileText && !imageBase64) {
    return NextResponse.json({ error: "Provide fileText and/or imageBase64." }, { status: 400 });
  }

  try {
    const result = await extractReceipt({ fileText, imageBase64, mediaType });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Extraction failed." }, { status: 502 });
  }
}
