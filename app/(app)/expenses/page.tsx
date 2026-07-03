import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Expenses" };

// Placeholder — expenses owns app/(app)/expenses/** (docs/OWNERSHIP.md).
export default function ExpensesPage() {
  return (
    <PlaceholderPage
      area="expenses"
      title="Expenses is on its way"
      description="Entries, PO-spawned drafts and the income/expense charts will live here."
    />
  );
}
