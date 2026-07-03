import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Settings" };

// Placeholder — the Settings hub itself has no single owner yet in
// docs/OWNERSHIP.md (its cards split across packages: Users & roles is
// auth-shell's `app/(app)/settings/users/**`, Expense accounts is expenses'
// `app/(app)/settings/expense-accounts/**`, distributors/search-rules/label
// size/concurrency are unassigned). This keeps `/settings` itself from
// 404ing for the owner until that hub page is built.
export default function SettingsPage() {
  return (
    <PlaceholderPage
      area="settings"
      title="Settings is on its way"
      description="Users & roles, search rules, distributors and label/print options will live here."
    />
  );
}
