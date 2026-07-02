import { describe, expect, test } from "bun:test";
import {
  createAnonClient,
  describeWithDb,
  hasLocalSupabase,
} from "../helpers/supabase";

/**
 * Integration-harness sanity check — plan/TESTING.md §2 "DB / RLS" layer.
 * Not a feature test: this is the "tests/integration ... example passing
 * test" baseline (R2-29 mission §1) proving `bun test` actually reaches
 * tests/integration and that the local-Supabase gate (tests/helpers/
 * supabase.ts) behaves as documented, BEFORE any DB-backed suite
 * (db-schema.test.ts, rls-matrix.test.ts) depends on it. Keep this green
 * always — in the fast checks job (no DB) AND the integration job (DB up).
 */

describe("integration harness", () => {
  test('bun test reaches tests/integration (bunfig.toml [test] root = "tests")', () => {
    expect(1 + 1).toBe(2);
  });

  test("hasLocalSupabase / describeWithDb gate is well-formed", () => {
    expect(typeof hasLocalSupabase).toBe("boolean");
    expect(typeof describeWithDb).toBe("function");
    // describeWithDb must be exactly `describe` or `describe.skip` (bun:test
    // registration calls must happen at file-load time, not from inside a
    // running test, so this is a reference check, never an invocation).
    expect([describe, describe.skip]).toContain(describeWithDb);
  });
});

// Only exercises a real client when a local stack is actually configured
// (CI's integration job after `supabase db reset`, or local dev after
// `bunx supabase start` — see docs/DEV.md). Stays `describe.skip` (not a
// failure) everywhere else, e.g. the fast typecheck+lint+unit CI job.
describeWithDb("local Supabase reachable", () => {
  test("createAnonClient builds a usable Supabase client (no network call)", () => {
    const client = createAnonClient();
    expect(typeof client.auth.signInWithPassword).toBe("function");
    expect(typeof client.from).toBe("function");
  });
});
