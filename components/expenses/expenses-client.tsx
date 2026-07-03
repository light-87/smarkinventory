"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { softDeleteEntryAction, restoreEntryAction } from "@/lib/expenses/actions";
import { useExpenseFilters } from "@/hooks/use-expense-filters";
import {
  buildAccountBreakdown,
  buildCategoryBreakdown,
  buildCumulativeNet,
  buildIncomeExpenseSeries,
  buildTopProjectsIncome,
  buildYoyCompare,
  buildSummaryTiles,
  trailingPeriods,
  type AiSpendSummary,
} from "@/lib/expenses/rollups";
import { periodLabel } from "@/lib/expenses/period";
import type { AccountOption, ChartBucket, EntryListItem, ProjectOption } from "@/lib/expenses/types";
import type { ExpenseRollupRow } from "@/types/db";
import type { Role } from "@/lib/auth/roles";
import { PeriodSwitcher } from "./period-switcher";
import { SummaryTiles } from "./summary-tiles";
import { EntryFiltersBar } from "./entry-filters-bar";
import { EntryTable } from "./entry-table";
import { EntryFormDrawer, type EntryFormMode } from "./entry-form-drawer";
import { IncomeExpenseBars } from "./charts/income-expense-bars";
import { CumulativeNetLine } from "./charts/cumulative-net-line";
import { CategoryDonut } from "./charts/category-donut";
import { ByAccountSplit } from "./charts/by-account-split";
import { TopProjectsIncome } from "./charts/top-projects-income";
import { YoyCompare } from "./charts/yoy-compare";
import { AiSpendMeter } from "./charts/ai-spend-meter";

const BUCKET_WINDOW: Record<ChartBucket, number> = { month: 12, quarter: 8, year: 5 };

export interface ExpensesClientProps {
  role: Role;
  entries: EntryListItem[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  rollups: ExpenseRollupRow[];
  aiSpend: AiSpendSummary;
}

export function ExpensesClient({ role, entries, accounts, projects, rollups, aiSpend }: ExpensesClientProps) {
  const router = useRouter();
  const { push } = useToast();
  const [, startTransition] = useTransition();
  const [bucket, setBucket] = useState<ChartBucket>("month");
  const [drawer, setDrawer] = useState<{ mode: EntryFormMode; entry: EntryListItem | null } | null>(null);
  // Bumped on every open so <EntryFormDrawer key={drawerKey}> remounts (and
  // re-seeds its draft state) each time, instead of reacting to prop changes
  // in an effect — see that component's doc comment.
  const [drawerKey, setDrawerKey] = useState(0);

  function openDrawer(next: { mode: EntryFormMode; entry: EntryListItem | null }) {
    setDrawer(next);
    setDrawerKey((k) => k + 1);
  }

  const { filters, setFilter, filteredEntries, exportHref, exportHrefXlsx, hasFilters, clearAll } = useExpenseFilters(entries);

  const drafts = useMemo(() => entries.filter((e) => e.is_draft), [entries]);
  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const periods = useMemo(() => trailingPeriods(bucket, BUCKET_WINDOW[bucket]), [bucket]);
  const currentPeriodValue = periods[periods.length - 1]!;
  const currentLabel = periodLabel(bucket, currentPeriodValue);

  const incomeExpenseSeries = useMemo(() => buildIncomeExpenseSeries(rollups, bucket, periods), [rollups, bucket, periods]);
  const cumulativeNet = useMemo(() => buildCumulativeNet(incomeExpenseSeries), [incomeExpenseSeries]);

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const categorySlices = useMemo(() => buildCategoryBreakdown(rollups, bucket, currentPeriodValue), [rollups, bucket, currentPeriodValue]);
  const accountSlices = useMemo(
    () => buildAccountBreakdown(rollups, bucket, currentPeriodValue, accountNameById),
    [rollups, bucket, currentPeriodValue, accountNameById],
  );
  const topProjects = useMemo(
    () => buildTopProjectsIncome(rollups, bucket, currentPeriodValue, projectNameById),
    [rollups, bucket, currentPeriodValue, projectNameById],
  );
  const yoy = useMemo(() => buildYoyCompare(rollups), [rollups]);
  const summaryTiles = useMemo(() => buildSummaryTiles(rollups), [rollups]);

  function refresh() {
    router.refresh();
  }

  function handleDelete(entry: EntryListItem) {
    startTransition(async () => {
      const result = await softDeleteEntryAction(entry.id);
      if (!result.ok) {
        push({ msg: result.error });
        return;
      }
      refresh();
      push({
        msg: "Entry deleted",
        undo: true,
        onUndo: () => {
          startTransition(async () => {
            const restored = await restoreEntryAction(entry.id);
            if (restored.ok) refresh();
          });
        },
      });
    });
  }

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-normal text-snow">Expenses</h1>
        <div className="flex items-center gap-2.5">
          {role === "owner" && (
            <Button variant="outline" size="md" onClick={() => (window.location.href = "/settings/expense-accounts")}>
              Accounts
            </Button>
          )}
          <Button size="md" onClick={() => openDrawer({ mode: "create", entry: null })}>
            + Add entry
          </Button>
        </div>
      </div>

      <SummaryTiles tiles={summaryTiles} />

      {drafts.length > 0 && (
        <Card tone="panel" className="border-smark-orange/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-snow">
              {drafts.length} draft{drafts.length === 1 ? "" : "s"} from placed orders need review
            </span>
            <Button size="sm" variant="accent-outline" onClick={() => openDrawer({ mode: "confirm", entry: drafts[0]! })}>
              Review next
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSwitcher value={bucket} onChange={setBucket} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IncomeExpenseBars series={incomeExpenseSeries} />
        <CumulativeNetLine series={cumulativeNet} />
        <CategoryDonut slices={categorySlices} periodLabel={currentLabel} />
        <ByAccountSplit slices={accountSlices} periodLabel={currentLabel} />
        <TopProjectsIncome slices={topProjects} periodLabel={currentLabel} />
        <YoyCompare points={yoy} thisYearLabel="This year" lastYearLabel="Last year" />
      </div>

      <AiSpendMeter summary={aiSpend} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-snow">Entries</h2>
          <div className="flex items-center gap-2">
            <a
              href={exportHref}
              className="inline-flex h-[38px] cursor-pointer items-center justify-center rounded-full border border-charcoal px-[18px] text-[13px] text-snow transition-colors hover:bg-ash"
            >
              Export CSV ↓
            </a>
            <a
              href={exportHrefXlsx}
              className="inline-flex h-[38px] cursor-pointer items-center justify-center rounded-full border border-charcoal px-[18px] text-[13px] text-snow transition-colors hover:bg-ash"
            >
              Export xlsx ↓
            </a>
          </div>
        </div>

        <EntryFiltersBar filters={filters} onChange={setFilter} onClear={clearAll} hasFilters={hasFilters} accounts={accounts} projects={projects} />

        <EntryTable
          entries={filteredEntries}
          onEdit={(entry) => openDrawer({ mode: "edit", entry })}
          onConfirmDraft={(entry) => openDrawer({ mode: "confirm", entry })}
          onDelete={handleDelete}
        />
      </div>

      <EntryFormDrawer
        key={drawerKey}
        open={drawer !== null}
        mode={drawer?.mode ?? "create"}
        entry={drawer?.entry ?? null}
        accounts={activeAccounts}
        projects={projects}
        onClose={() => setDrawer(null)}
        onSaved={refresh}
      />
    </div>
  );
}
