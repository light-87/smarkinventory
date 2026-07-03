import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "bun:test";
import { createServiceClient, describeWithDb } from "../helpers/supabase";
import { TABLES } from "@/types/db";

/**
 * tests/integration/e2e-canonical-demo-seed-guarantee.test.ts — regression
 * for the flow-5 "Scan take-out" failure (root cause, correcting the initial
 * retry/debounce-race hypothesis): `scripts/seed-canonical-demo.ts` writes
 * the SMK-000101 family every flow-5/flow-2/flow-8/cart-smoke/takeout-
 * bulk-pick spec assumes exists, but `supabase db reset` never runs it —
 * previously only `notifications-search-palette.spec.ts` called it, from its
 * OWN `test.beforeAll`. Under `fullyParallel: true` + 2 workers, that spec
 * running concurrently with (not necessarily BEFORE) any other spec meant
 * `smark_parts` could genuinely be empty when e.g. flow-5's Scan step looked
 * up SMK-000101.
 *
 * Confirmed live (not just theorised): instrumenting `hooks/use-scanner.ts`'s
 * resolveCode and running flow-3+flow-5 together repeatedly against a fresh
 * `db reset` produced `{"rawCode":"SMK-000101",...,"directCount":0,
 * "directCountError":null}` — a genuine, correct "no match" against an
 * empty table, not a bug in lib/scan/resolve.ts or the HID debounce buffer.
 * flow-5's own assertion right after (`page.getByText(SEEDED_PID)`, unscoped)
 * then false-positived on the "No match" toast's OWN text (`No match for
 * "${code}"` contains the PID too), masking the real failure as a hang on
 * the next line waiting for a "Take out" button that could never appear —
 * fixed separately in tests/e2e/flow-5-team-day.spec.ts by scoping that
 * assertion to `<main>` (the toast viewport is a sibling, per
 * components/shell/app-shell.tsx).
 *
 * The actual fix: `tests/e2e/global-setup.ts` (Playwright's own
 * guaranteed-once-before-every-spec hook, already used for dev-role users)
 * now also runs `scripts/seed-canonical-demo.ts` right after, closing the
 * scheduling race for every dependent spec at once instead of each one
 * re-implementing its own guard. This test runs that SAME pair of scripts for
 * real (both are explicitly idempotent — dev users: create-or-reset-password;
 * canonical demo: matches-and-patches, never destructive — see their own file
 * headers) and asserts the canonical part exists afterward, exercising the
 * fixed mechanism directly rather than re-covering `resolveScanCode`'s
 * already-tested (and never broken) null-on-no-match behaviour
 * (tests/unit/scan-resolve.test.ts).
 *
 * Not a direct call to `tests/e2e/global-setup.ts`'s exported function: Bun's
 * dotenv auto-load skips `.env.local` specifically for `NODE_ENV=test` (see
 * tests/helpers/supabase.ts's header) — never true for Playwright's real
 * invocation, but `bun test` itself sets `NODE_ENV=test` on THIS process,
 * which `execFileSync` would otherwise inherit into the child and break it
 * even though `bun test` already loaded the same keys into `process.env`
 * itself. Spawning the same two scripts here with that one var overridden to
 * "development" mirrors global-setup.ts's real sequence without needing to
 * change it for a test-harness-only concern.
 */
describeWithDb("e2e global-setup guarantees the canonical demo dataset before any spec runs [bug regression]", () => {
  function runSeedScript(scriptPath: string): void {
    const repoRoot = path.resolve(__dirname, "..", "..");
    // "development", not a `delete` — this repo's ProcessEnv augmentation
    // declares NODE_ENV as required, and the practical goal is only "not
    // 'test'" (see the file header) so the child's own Bun runtime auto-loads
    // .env.local instead of skipping it.
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
    execFileSync("bun", ["run", scriptPath], { cwd: repoRoot, stdio: "inherit", shell: true, env: childEnv });
  }

  test("running the same seed scripts global-setup.ts runs seeds the SMK-000101 canonical part (idempotent — safe even when already seeded)", async () => {
    runSeedScript("scripts/seed-dev-users.ts"); // seed-canonical-demo.ts looks up the owner user by username — same order as global-setup.ts
    runSeedScript("scripts/seed-canonical-demo.ts");

    const service = createServiceClient();
    const { data, error } = await service.from(TABLES.parts).select("id, internal_pid").eq("internal_pid", "SMK-000101").maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as { internal_pid: string } | null)?.internal_pid).toBe("SMK-000101");
  });
});
