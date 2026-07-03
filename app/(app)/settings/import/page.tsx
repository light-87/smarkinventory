import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, SectionLabel } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Chip } from "@/components/ui/chip";
import { formatNumber } from "@/lib/format";
import { TABLES } from "@/types/db";

export const metadata: Metadata = { title: "Data import" };

/**
 * app/(app)/settings/import/page.tsx — placeholder for the Stock List import
 * surface (FEATURES.md §14). Real UI (upload, live progress, per-sheet
 * review) lands with the Receive onboarding queue; until then this page is
 * the run-book: exact commands + the current onboarding backlog so the
 * owner can see the import actually happened without opening a terminal.
 *
 * NOTE for the integrator: this route isn't listed under any package in
 * docs/OWNERSHIP.md (only `settings/users` [auth-shell] and
 * `settings/expense-accounts` [expenses] are). Created here per the import
 * package's mission brief; please confirm final ownership of
 * `app/(app)/settings/import/**` when wiring up the Settings nav.
 */

interface SheetRow {
  sheet: string;
  rows: number | null;
}

/** Real per-sheet counts from the last verified parse of the checked-in fixture (tests/fixtures/Stock List.xlsx). */
const REFERENCE_SHEET_COUNTS: SheetRow[] = [
  { sheet: "Index", rows: null },
  { sheet: "S2 - SMD IC", rows: 476 },
  { sheet: "S3 - Res", rows: 435 },
  { sheet: "S4- Cap", rows: 270 },
  { sheet: "S5-Ind+Diode", rows: 218 },
  { sheet: "S6-MiscElec", rows: 93 },
  { sheet: "Material List", rows: 30 },
  { sheet: "S7-SMD Modules", rows: 54 },
  { sheet: "S8-TH IC", rows: 30 },
  { sheet: "S9-Misc Elec", rows: 64 },
  { sheet: "S10-Conectors1", rows: 150 },
  { sheet: "S11-Conectors2", rows: 133 },
  { sheet: "S12-Stencils", rows: null },
  { sheet: "SMPS", rows: 107 },
  { sheet: "VOLTAGE PROTECTOR", rows: 4 },
];

interface OnboardingStats {
  needsReview: number | null;
  sourceSheets: number | null;
  error: string | null;
}

async function loadOnboardingStats(): Promise<OnboardingStats> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from(TABLES.parts)
      .select("*", { count: "exact", head: true })
      .eq("needs_review", true);
    if (error) throw error;

    const { data: sheetRows, error: sheetErr } = await supabase
      .from(TABLES.parts)
      .select("source_sheet")
      .not("source_sheet", "is", null);
    if (sheetErr) throw sheetErr;
    const distinctSheets = new Set((sheetRows ?? []).map((r) => r.source_sheet)).size;

    return { needsReview: count ?? 0, sourceSheets: distinctSheets, error: null };
  } catch (err) {
    return { needsReview: null, sourceSheets: null, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-charcoal bg-surface-well px-4 py-3 font-mono text-xs text-silver-mist">
      {children}
    </pre>
  );
}

export default async function ImportSettingsPage() {
  const stats = await loadOnboardingStats();

  return (
    <div className="mx-auto max-w-[860px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-1 flex items-center gap-2.5">
        <h1 className="text-subheading font-medium text-snow">Data import</h1>
        <Chip tone="soft">placeholder</Chip>
      </div>
      <p className="text-body-sm text-smoke">
        The 15-sheet Stock List importer (FEATURES.md §14) runs as a script today — a full upload +
        live-review UI ships together with the Receive onboarding queue. This page is the run-book
        until then.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          value={stats.needsReview === null ? "—" : formatNumber(stats.needsReview)}
          label="parts awaiting onboarding review"
          tone={stats.needsReview ? "accent" : "success"}
          mono
        />
        <StatCard
          value={stats.sourceSheets === null ? "—" : formatNumber(stats.sourceSheets)}
          label="distinct source sheets represented"
          tone="default"
          mono
        />
      </div>
      {stats.error && <p className="mt-2 text-caption text-smark-orange-soft">{stats.error}</p>}

      <div className="mt-8 flex flex-col gap-4">
        <Card padding="none">
          <CardHeader title="1 · Dry-run the import" meta="no writes" />
          <CardBody>
            <p className="text-body-sm text-smoke">
              Parses the workbook and prints the plan (sheet counts, needs_review split, new vs.
              matched parts) without touching the database.
            </p>
            <CodeBlock>{`bun run scripts/import-stocklist.ts "Stock List.xlsx" --dry-run --verbose`}</CodeBlock>
          </CardBody>
        </Card>

        <Card padding="none">
          <CardHeader title="2 · Run it for real" />
          <CardBody>
            <p className="text-body-sm text-smoke">
              Upserts into <code className="font-mono text-silver-mist">smark_parts</code>, matched
              against the existing catalog by normalized MPN then LCSC PN — reruns are idempotent, a
              part already on the shelf never gets a second row. Creates{" "}
              <span className="text-snow">no locations</span> — every imported part lands (or stays){" "}
              <code className="font-mono text-silver-mist">needs_review = true</code>.
            </p>
            <CodeBlock>{`bun run scripts/import-stocklist.ts "Stock List.xlsx"`}</CodeBlock>
          </CardBody>
        </Card>

        <Card padding="none">
          <CardHeader title="3 · Assign locations + print labels" />
          <CardBody>
            <p className="text-body-sm text-smoke">
              Every part above surfaces in <span className="text-snow">Receive → onboarding queue</span>{" "}
              — assign Shelf → Big Box → ESD, batch-print one Avery sheet. That flow (not this page)
              owns the real UI.
            </p>
          </CardBody>
        </Card>

        <Card padding="none">
          <CardHeader title="Canonical demo data" meta="dev / preview only" />
          <CardBody>
            <p className="text-body-sm text-smoke">
              Seeds the approved prototype fixture (4 shelves, 9 big boxes, the SMK-000101 family with
              real locations + priced history) — safe to rerun, matches existing rows by identity
              rather than duplicating.
            </p>
            <CodeBlock>{`bun run scripts/seed-canonical-demo.ts`}</CodeBlock>
          </CardBody>
        </Card>
      </div>

      <div className="mt-8">
        <SectionLabel>Reference — last verified parse of the real file</SectionLabel>
        <Card padding="none" className="mt-2.5">
          <div className="divide-y divide-border-divider">
            {REFERENCE_SHEET_COUNTS.map((row) => (
              <div key={row.sheet} className="flex items-center justify-between px-5 py-2.5 text-body-sm">
                <span className="text-silver-mist">{row.sheet}</span>
                {row.rows === null ? (
                  <Chip tone="default">not a parts sheet</Chip>
                ) : (
                  <span className="font-mono text-snow">{formatNumber(row.rows)} rows</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
