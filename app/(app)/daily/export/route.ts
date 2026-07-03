import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canSee, dataScope } from "@/lib/auth/roles";
import { ExportQuerySchema } from "@/lib/daily/types";
import { dateRangeToIsoBounds, isValidDateOnly, todayDateOnly } from "@/lib/daily/compute";
import {
  getAttendanceForRange,
  getExpensesForRange,
  getHoursForRange,
  getMovementsForRange,
  getUserNames,
} from "@/lib/daily/queries";
import { buildDailyExportCsv, buildDailyExportXlsx, type DailyExportData } from "@/lib/daily/export";

/**
 * GET /daily/export?from=...&to=...&format=csv|xlsx&person=all|<uuid> — R2-33:
 * "Export a day (or range) as CSV/xlsx — movements + attendance + hours
 * (+ expenses for owner/accountant)". Mirrors app/(app)/inventory/export's
 * Route-Handler shape; the query string is exactly what
 * components/daily/export-panel.tsx's `<form method="get">` encodes.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canSee(user.role, "daily_reports")) {
    return NextResponse.json({ error: "Not signed in, or no access to Daily Reports." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const today = todayDateOnly();
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");

  const parsed = ExportQuerySchema.safeParse({
    from: rawFrom && isValidDateOnly(rawFrom) ? rawFrom : today,
    to: rawTo && isValidDateOnly(rawTo) ? rawTo : today,
    format: searchParams.get("format") === "csv" ? "csv" : "xlsx",
    person: searchParams.get("person") ?? "all",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  }
  const { from, to, format, person } = parsed.data;

  const scope = dataScope(user.role, "daily_reports");
  const actorFilter = scope === "self" ? user.id : person === "all" ? null : person;
  const showExpenses = canSee(user.role, "expenses");

  const supabase = await createClient();
  const bounds = dateRangeToIsoBounds(from, to);

  const [allAttendance, allHours, movements, expenses] = await Promise.all([
    getAttendanceForRange(supabase, from, to),
    getHoursForRange(supabase, from, to),
    getMovementsForRange(supabase, bounds, actorFilter),
    showExpenses ? getExpensesForRange(supabase, from, to) : Promise.resolve(null),
  ]);

  const attendance = actorFilter ? allAttendance.filter((a) => a.userId === actorFilter) : allAttendance;
  const hours = actorFilter ? allHours.filter((h) => h.userId === actorFilter) : allHours;

  const nameById = await getUserNames(supabase, [
    ...movements.map((m) => m.actorId),
    ...attendance.map((a) => a.userId),
    ...hours.map((h) => h.userId),
  ]);

  const data: DailyExportData = {
    movements: movements.map((row) => ({ row, actorName: nameById.get(row.actorId) ?? "Unknown" })),
    attendance: attendance.map((a) => ({
      workDate: a.workDate,
      personName: nameById.get(a.userId) ?? "Unknown",
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      currentProjectName: a.currentProjectName,
    })),
    hours: hours.map((h) => ({
      workDate: h.workDate,
      personName: nameById.get(h.userId) ?? "Unknown",
      projectName: h.projectName,
      hours: h.hours,
      note: h.note,
    })),
    expenses: expenses
      ? expenses.map((e) => ({
          entryDate: e.entryDate,
          entryType: e.entryType,
          amount: e.amount,
          category: e.category,
          vendor: e.vendor,
          note: e.note,
          isDraft: e.isDraft,
        }))
      : null,
  };

  const rangeLabel = from === to ? from : `${from}_to_${to}`;

  if (format === "csv") {
    return new NextResponse(buildDailyExportCsv(data), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="smarkstock-daily-${rangeLabel}.csv"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(buildDailyExportXlsx(data)), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="smarkstock-daily-${rangeLabel}.xlsx"`,
    },
  });
}
