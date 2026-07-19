/**
 * app/api/cart/xlsx/route.ts — "Download Excel" for the global Cart tab: the
 * open cart lines with each one's chosen vendor, stock, cost, and link. A Route
 * Handler (binary download), same shape as the review-xlsx route.
 *
 * Two clients: the per-request client reads the cart under the caller's RLS;
 * the service client resolves the chosen `smark_agent_results` row (vendor
 * stock + link) + distributor name, which the per-request client can't read.
 */

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";
import { getCartLines } from "@/lib/orders/queries";
import { buildCartXlsx, type CartResultInfo } from "@/lib/orders/cart-xlsx";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const lines = (await getCartLines(supabase)).filter((line) => line.status === "open");

    const resultIds = Array.from(new Set(lines.map((l) => l.chosenResultId).filter((id): id is string => Boolean(id))));
    const distributorIds = Array.from(new Set(lines.map((l) => l.distributorId).filter((id): id is string => Boolean(id))));

    const service = createServiceClient();
    const [resultsRes, distRes] = await Promise.all([
      resultIds.length
        ? service.from(TABLES.agent_results).select("id, stock_qty, order_link").in("id", resultIds)
        : Promise.resolve({ data: [] as { id: string; stock_qty: number | null; order_link: string | null }[], error: null }),
      distributorIds.length
        ? service.from(TABLES.distributors).select("id, name").in("id", distributorIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    ]);
    if (resultsRes.error) throw resultsRes.error;
    if (distRes.error) throw distRes.error;

    const resultById = new Map<string, CartResultInfo>(
      (resultsRes.data ?? []).map((r) => [r.id, { stockQty: r.stock_qty, orderLink: r.order_link }]),
    );
    const distributorNameById = new Map<string, string>((distRes.data ?? []).map((d) => [d.id, d.name]));

    const xlsx = buildCartXlsx(lines, resultById, distributorNameById);
    return new NextResponse(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cart-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[cart-xlsx] build failed:", error);
    return NextResponse.json({ error: "Could not build the Excel file. Please try again." }, { status: 500 });
  }
}
