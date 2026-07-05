import { describe, expect, test } from "bun:test";
import {
  ATTENDANCE_EXPORT_HEADERS,
  attendanceExportRow,
  HOURS_EXPORT_HEADERS,
  hoursExportRow,
  MOVEMENT_EXPORT_HEADERS,
  movementExportRow,
  type MovementDailyRow,
} from "@/lib/daily/compute";
import { buildDailyExportCsv, buildDailyExportXlsx, type DailyExportData } from "@/lib/daily/export";

/**
 * R2-33 export shaping. Row-builders (lib/daily/compute.ts) are asserted
 * directly for column order/content; the CSV/xlsx assembly (lib/daily/
 * export.ts, the only module that imports `xlsx`) is asserted at the
 * structural level (section titles present, a real xlsx Buffer comes back).
 *
 * The Expenses section (columns/row-builder/sheet) was removed along with
 * the Expenses tab/UI — Daily Reports' export is movements/attendance/hours
 * only now.
 */

const sampleMovement: MovementDailyRow = {
  id: "m1",
  occurredAt: "2026-07-03T10:15:00.000Z",
  actorId: "user-a",
  deltaQty: -145,
  reason: "bulk_pick",
  reasonDetail: null,
  pid: "SMK-000101",
  boxLabel: "B · B-12",
  bomName: "TMCS Mainboard",
};

const sampleData: DailyExportData = {
  movements: [{ row: sampleMovement, actorName: "Suresh" }],
  attendance: [
    {
      workDate: "2026-07-03",
      personName: "Suresh",
      checkIn: "2026-07-03T03:32:00.000Z",
      checkOut: null,
      currentProjectName: "TMCS Gen4",
    },
  ],
  hours: [{ workDate: "2026-07-03", personName: "Suresh", projectName: "TMCS Gen4", hours: 6.5, note: "PCB bring-up" }],
};

describe("row builders — column order matches the *_EXPORT_HEADERS", () => {
  test("movementExportRow", () => {
    const row = movementExportRow(sampleMovement, "Suresh");
    expect(row).toHaveLength(MOVEMENT_EXPORT_HEADERS.length);
    expect(row[2]).toBe("Suresh"); // Person
    expect(row[3]).toBe("took"); // Verb
    expect(row[4]).toBe(145); // Qty (absolute)
    expect(row[5]).toBe("SMK-000101"); // PID
  });

  test("attendanceExportRow renders '' for a missing check-out, not null/undefined", () => {
    const row = attendanceExportRow(sampleData.attendance[0]!);
    expect(row).toHaveLength(ATTENDANCE_EXPORT_HEADERS.length);
    expect(row[3]).toBe("");
  });

  test("hoursExportRow", () => {
    const row = hoursExportRow(sampleData.hours[0]!);
    expect(row).toHaveLength(HOURS_EXPORT_HEADERS.length);
    expect(row).toEqual(["3 Jul 2026", "Suresh", "TMCS Gen4", 6.5, "PCB bring-up"]);
  });
});

describe("buildDailyExportCsv", () => {
  test("emits one titled block per section, in a fixed order", () => {
    const csv = buildDailyExportCsv(sampleData);
    const movementsIdx = csv.indexOf("Movements");
    const attendanceIdx = csv.indexOf("Attendance");
    const hoursIdx = csv.indexOf("Hours");
    expect(movementsIdx).toBeGreaterThanOrEqual(0);
    expect(attendanceIdx).toBeGreaterThan(movementsIdx);
    expect(hoursIdx).toBeGreaterThan(attendanceIdx);
  });

  test("quotes a field containing a comma (RFC 4180)", () => {
    const csv = buildDailyExportCsv({
      ...sampleData,
      hours: [{ ...sampleData.hours[0]!, note: "bring-up, testing" }],
    });
    expect(csv).toContain('"bring-up, testing"');
  });
});

describe("buildDailyExportXlsx", () => {
  test("returns a non-empty Buffer that starts with the ZIP/xlsx magic bytes", () => {
    const buf = buildDailyExportXlsx(sampleData);
    expect(buf.length).toBeGreaterThan(0);
    // .xlsx is a zip container — "PK" signature.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
