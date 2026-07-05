import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { accessFor } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { readAppConfig } from "@/lib/settings/app-config";
import { getDistributors, getOrderingRules, getPartFieldTemplates } from "@/lib/settings/queries";
import { AppConfigCards } from "@/components/settings/app-config-cards";
import { DistributorsCard } from "@/components/settings/distributors-card";
import { PartFieldTemplatesCard } from "@/components/settings/part-field-templates-card";
import { SearchRulesCard } from "@/components/settings/search-rules-card";
import { ConnectedAccountsCard, SettingsLinksCard } from "@/components/settings/settings-links-card";

export const metadata: Metadata = { title: "Settings" };

/**
 * `/settings` (plan/tab-settings.md, FEATURES.md §5.16) — owner-only hub
 * (§2: "AI Memory approve · Settings · user management" row). Sections owned
 * by other packages (Users & roles → auth-shell, Expense accounts →
 * expenses) are link-outs only; everything else on this page is owned here
 * (docs/OWNERSHIP.md "Settings completion (R2-28 + R2-01 leftovers)").
 */
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user || accessFor(user.role, "settings") !== "full") notFound();

  const supabase = await createClient();
  const [rules, distributors, partFieldTemplates, appConfig] = await Promise.all([
    getOrderingRules(supabase),
    getDistributors(supabase),
    getPartFieldTemplates(supabase),
    readAppConfig(),
  ]);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <h1 className="text-[24px] font-normal text-snow">Settings</h1>

      <SettingsLinksCard
        rows={[
          { href: "/settings/users", title: "Users & roles", description: "Add employees/accountants, reset passwords, deactivate" },
          { href: "/settings/employees", title: "Employees", description: "Profiles + documents (DOB, DOJ, PAN, bank, uploads)" },
          { href: "/settings/expense-accounts", title: "Expense accounts", description: "Cash / bank / UPI accounts for Expenses" },
        ]}
      />

      <DistributorsCard distributors={distributors} />
      <SearchRulesCard rules={rules} />
      <AppConfigCards config={appConfig} />
      <PartFieldTemplatesCard templates={partFieldTemplates} />
      <ConnectedAccountsCard />
    </div>
  );
}
