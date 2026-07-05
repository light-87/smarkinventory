import { describe, expect, test } from "bun:test";
import {
  buildCalendar,
  computeCompBalance,
  countDaysInclusive,
  datesInRange,
  findApprovedLeaveForDate,
  findHolidayForDate,
  monthRange,
  resolveDayStatus,
  weekdayOf,
  type ApprovedLeaveInput,
  type HolidayInput,
} from "@/lib/attendance/status";

/**
 * lib/attendance/status — the derive-never-store attendance rule (migration
 * 0009 header / prompt resolution order). `smark_attendance` only ever
 * carries a row for a PRESENT user; this suite is the executable spec for
 * what every other outcome (holiday/leave/absent/not-marked/compensatory)
 * means for a day with no row.
 */

const SUNDAY_WEEKLY_OFF: HolidayInput = { kind: "weekly_off", holidayDate: null, weekday: 0, name: "Weekly off" };
const DIWALI: HolidayInput = { kind: "specific", holidayDate: "2026-07-10", weekday: null, name: "Diwali" };

describe("weekdayOf", () => {
  test("2026-07-05 is a Sunday (0)", () => {
    expect(weekdayOf("2026-07-05")).toBe(0);
  });
  test("2026-07-10 is a Friday (5)", () => {
    expect(weekdayOf("2026-07-10")).toBe(5);
  });
});

describe("findHolidayForDate", () => {
  test("matches a specific date", () => {
    expect(findHolidayForDate("2026-07-10", [DIWALI])?.name).toBe("Diwali");
  });

  test("matches a weekly-off weekday", () => {
    expect(findHolidayForDate("2026-07-05", [SUNDAY_WEEKLY_OFF])?.name).toBe("Weekly off");
  });

  test("a specific date takes priority over a matching weekly-off (same date)", () => {
    // 2026-07-12 is a Sunday AND (hypothetically) also a named specific holiday.
    const namedSunday: HolidayInput = { kind: "specific", holidayDate: "2026-07-12", weekday: null, name: "Founders Day" };
    const result = findHolidayForDate("2026-07-12", [SUNDAY_WEEKLY_OFF, namedSunday]);
    expect(result?.name).toBe("Founders Day");
  });

  test("returns null when neither matches", () => {
    expect(findHolidayForDate("2026-07-06", [SUNDAY_WEEKLY_OFF, DIWALI])).toBeNull();
  });
});

describe("findApprovedLeaveForDate", () => {
  const leave: ApprovedLeaveInput = { startDate: "2026-07-08", endDate: "2026-07-09", reason: "sick" };

  test("matches inside an inclusive range", () => {
    expect(findApprovedLeaveForDate("2026-07-08", [leave])?.reason).toBe("sick");
    expect(findApprovedLeaveForDate("2026-07-09", [leave])?.reason).toBe("sick");
  });

  test("no match outside the range", () => {
    expect(findApprovedLeaveForDate("2026-07-07", [leave])).toBeNull();
    expect(findApprovedLeaveForDate("2026-07-10", [leave])).toBeNull();
  });
});

describe("resolveDayStatus — precedence order", () => {
  const today = "2026-07-06";

  test("holiday precedence: specific holiday + no attendance row → holiday", () => {
    const result = resolveDayStatus({
      date: "2026-07-10",
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [DIWALI],
      approvedLeaves: [],
    });
    expect(result).toEqual({ status: "holiday", holidayName: "Diwali", leaveReason: null });
  });

  test("weekly-off day + no attendance row → holiday", () => {
    const result = resolveDayStatus({
      date: "2026-07-05", // Sunday
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [SUNDAY_WEEKLY_OFF],
      approvedLeaves: [],
    });
    expect(result.status).toBe("holiday");
    expect(result.holidayName).toBe("Weekly off");
  });

  test("compensatory: holiday date WITH an attendance row → compensatory, not holiday", () => {
    const result = resolveDayStatus({
      date: "2026-07-10",
      todayDate: today,
      hasAttendanceRow: true,
      holidays: [DIWALI],
      approvedLeaves: [],
    });
    expect(result).toEqual({ status: "compensatory", holidayName: "Diwali", leaveReason: null });
  });

  test("plain present: attendance row, not a holiday", () => {
    const result = resolveDayStatus({
      date: "2026-07-06",
      todayDate: today,
      hasAttendanceRow: true,
      holidays: [],
      approvedLeaves: [],
    });
    expect(result).toEqual({ status: "present", holidayName: null, leaveReason: null });
  });

  test("attendance row wins over an approved leave for the same day (shouldn't normally coexist, but presence is ground truth)", () => {
    const result = resolveDayStatus({
      date: "2026-07-06",
      todayDate: today,
      hasAttendanceRow: true,
      holidays: [],
      approvedLeaves: [{ startDate: "2026-07-06", endDate: "2026-07-06", reason: "sick" }],
    });
    expect(result.status).toBe("present");
  });

  test("approved leave covers the day → leave + reason", () => {
    const result = resolveDayStatus({
      date: "2026-07-03",
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [],
      approvedLeaves: [{ startDate: "2026-07-01", endDate: "2026-07-04", reason: "personal" }],
    });
    expect(result).toEqual({ status: "leave", holidayName: null, leaveReason: "personal" });
  });

  test("past working day, nothing else applies → absent (computed, not stored)", () => {
    const result = resolveDayStatus({
      date: "2026-07-01",
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [],
      approvedLeaves: [],
    });
    expect(result).toEqual({ status: "absent", holidayName: null, leaveReason: null });
  });

  test("today, unmarked → not_marked (not absent)", () => {
    const result = resolveDayStatus({
      date: today,
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [],
      approvedLeaves: [],
    });
    expect(result).toEqual({ status: "not_marked", holidayName: null, leaveReason: null });
  });

  test("future day, unmarked → not_marked", () => {
    const result = resolveDayStatus({
      date: "2026-07-20",
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [],
      approvedLeaves: [],
    });
    expect(result.status).toBe("not_marked");
  });

  test("retroactive holiday clears an absent: the SAME past day with the holiday added flips absent → holiday", () => {
    const withoutHoliday = resolveDayStatus({
      date: "2026-07-01",
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [],
      approvedLeaves: [],
    });
    expect(withoutHoliday.status).toBe("absent");

    const withHolidayAddedLater: HolidayInput = { kind: "specific", holidayDate: "2026-07-01", weekday: null, name: "Surprise holiday" };
    const withHoliday = resolveDayStatus({
      date: "2026-07-01",
      todayDate: today,
      hasAttendanceRow: false,
      holidays: [withHolidayAddedLater],
      approvedLeaves: [],
    });
    expect(withHoliday).toEqual({ status: "holiday", holidayName: "Surprise holiday", leaveReason: null });
  });

  test("retroactive holiday does NOT disturb a comp-worker who already has an attendance row (stays present-family)", () => {
    const holiday: HolidayInput = { kind: "specific", holidayDate: "2026-07-01", weekday: null, name: "Surprise holiday" };
    const result = resolveDayStatus({
      date: "2026-07-01",
      todayDate: today,
      hasAttendanceRow: true,
      holidays: [holiday],
      approvedLeaves: [],
    });
    expect(result.status).toBe("compensatory");
  });
});

describe("date helpers", () => {
  test("datesInRange is inclusive both ends", () => {
    expect(datesInRange("2026-07-01", "2026-07-03")).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });

  test("datesInRange handles a single day", () => {
    expect(datesInRange("2026-07-01", "2026-07-01")).toEqual(["2026-07-01"]);
  });

  test("datesInRange crosses a month boundary", () => {
    expect(datesInRange("2026-07-30", "2026-08-01")).toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
  });

  test("countDaysInclusive", () => {
    expect(countDaysInclusive("2026-07-01", "2026-07-05")).toBe(5);
    expect(countDaysInclusive("2026-07-01", "2026-07-01")).toBe(1);
  });

  test("monthRange returns the full calendar month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  test("monthRange handles a leap year February", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("buildCalendar — month/range calendar builder", () => {
  test("maps resolveDayStatus over every day: past-absent, weekly-off-holiday, present-today, future-not-marked", () => {
    // 2026-07-04 Sat (past, unmarked) · 07-05 Sun (weekly off) · 07-06 Mon (today, present) · 07-07 Tue (future)
    const calendar = buildCalendar({
      from: "2026-07-04",
      to: "2026-07-07",
      todayDate: "2026-07-06",
      attendanceDates: new Set(["2026-07-06"]),
      holidays: [SUNDAY_WEEKLY_OFF],
      approvedLeaves: [],
    });

    expect(calendar).toEqual([
      { date: "2026-07-04", status: "absent", holidayName: null, leaveReason: null },
      { date: "2026-07-05", status: "holiday", holidayName: "Weekly off", leaveReason: null },
      { date: "2026-07-06", status: "present", holidayName: null, leaveReason: null },
      { date: "2026-07-07", status: "not_marked", holidayName: null, leaveReason: null },
    ]);
  });
});

describe("computeCompBalance", () => {
  test("approved comp-work days minus approved compensatory-leave days", () => {
    expect(computeCompBalance(3, 1)).toBe(2);
    expect(computeCompBalance(0, 0)).toBe(0);
  });

  test("can go negative when over-spent (UI/actions block this before insert, the pure helper just computes)", () => {
    expect(computeCompBalance(1, 3)).toBe(-2);
  });
});
