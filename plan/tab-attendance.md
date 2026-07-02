# Attendance & Team Time — MERGED into Daily Reports (R2-07)

> **This tab no longer ships standalone.** R2-07 introduced a **Daily Reports** tab whose Section 1
> is exactly the attendance + hours surface planned here. All content moved to
> [`tab-daily-reports.md`](tab-daily-reports.md). This stub stays so R2-02/R2-04 references resolve.

- R2-02 (attendance tracking) → now specified in `tab-daily-reports.md` §2 Section 1. Confirmed by
  R2-07 wording: attendance is **self-marked** (Q-03(a) answered).
- R2-04 (hours per project) → owner range-views + per-project rollups render in the **project hub
  Team & hours** section (`tab-orders-projects.md`) fed by the same `smark_time_entries`; day-level
  capture lives in Daily Reports.
- Open: **Q-03(b)** hours model · via **Q-01** who sees whose attendance.
- Schema unchanged by the merge: `smark_attendance`, `smark_time_entries`, `smark_project_members`
  as defined in `SCHEMA.md` §7.
