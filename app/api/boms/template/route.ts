/**
 * app/api/boms/template/route.ts — downloadable BOM xlsx template (R2-19).
 *
 * GET returns the current company template's columns (standard + any
 * remembered custom ones, `lib/bom/template.ts`) rendered as an empty,
 * ready-to-fill workbook — "the downloadable xlsx template gains the custom
 * columns too" (plan/tab-orders-projects.md R2-19). A Route Handler (not a
 * Server Action) since it returns a binary file download, mirroring
 * `app/api/labels/print-sheet/route.ts`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canSee } from "@/lib/auth/roles";
import { getEffectiveBomColumns } from "@/lib/bom/template";
import { buildBomTemplateWorkbook } from "@/lib/bom/xlsx-template";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canSee(role, "projects")) {
    return NextResponse.json({ error: "You don't have access to Projects." }, { status: 403 });
  }

  const columns = await getEffectiveBomColumns(supabase);
  const workbook = buildBomTemplateWorkbook(columns);

  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="bom-template.xlsx"',
    },
  });
}
