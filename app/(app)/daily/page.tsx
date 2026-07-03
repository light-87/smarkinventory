import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Daily Reports" };

// Placeholder — daily-reports owns app/(app)/daily/** (docs/OWNERSHIP.md).
export default function DailyReportsPage() {
  return (
    <PlaceholderPage
      area="daily_reports"
      title="Daily Reports is on its way"
      description="Attendance, manual hours and the day/range activity digest will live here."
    />
  );
}
