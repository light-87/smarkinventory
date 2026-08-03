/**
 * app/api/cron/comp-reset/route.ts — the 1 January comp-off rollover
 * (migration 0020), driven by a daily Vercel Cron (see vercel.json).
 *
 * Each new year, every active employee's leftover comp-off is cleared and
 * anyone flagged as entitled is granted their annual days. The owner chose
 * "reset to the grant, unused lost", so last year's balance does not carry.
 *
 * Runs DAILY and no-ops on 364 of those days rather than being scheduled once
 * a year, because a yearly cron that fails or is missed silently costs
 * everyone their entitlement for twelve months. The work itself is guarded by
 * a unique index on (user_id, source_kind, period_year), so running it every
 * day in January — or twice in one minute — still produces exactly one reset
 * and one grant per person per year.
 *
 * Auth + client follow app/api/cron/client-reminders/route.ts: a shared
 * secret (no cron invocation carries a session) and the RLS-bypassing service
 * client, since this acts for the company rather than for any signed-in user.
 *
 * `?year=` and `?force=1` exist for the owner to run the rollover by hand —
 * the first January after go-live, or if the schedule was down.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runAnnualCompReset } from "@/lib/attendance/comp-ledger";
import { istDateOnly } from "@/lib/timezone";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run un-authed, even in an unconfigured env

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const cronHeader = request.headers.get("x-cron-secret");
  return cronHeader === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  // The company's own calendar day, not UTC's — a run just after midnight IST
  // on 1 January is still 31 December in UTC, and would roll the wrong year.
  const today = istDateOnly();
  const [yearStr, month, day] = today.split("-");
  const currentYear = Number(yearStr);

  const requestedYear = Number(url.searchParams.get("year"));
  const year = Number.isInteger(requestedYear) && requestedYear > 2000 ? requestedYear : currentYear;

  // Ordinary days: nothing to do. Kept as an early return rather than letting
  // the idempotency index absorb it, so the daily run stays a single cheap
  // check for all but a few days a year.
  const isJanuary = month === "01";
  if (!isJanuary && !force) {
    return NextResponse.json({ ok: true, skipped: "not January", today });
  }

  try {
    const supabase = createServiceClient();
    const result = await runAnnualCompReset(supabase, year, force ? today : `${year}-01-01`);
    console.info(
      `[cron] comp-reset ${year}: ${result.usersProcessed} employees, ${result.resetEntries} reset, ${result.grantEntries} granted`,
    );
    return NextResponse.json({ ok: true, today, day, ...result });
  } catch (error) {
    console.error("[cron] comp-reset failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Comp-off reset failed." },
      { status: 500 },
    );
  }
}
