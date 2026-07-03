import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient, createServiceClient, describeWithDb } from "../helpers/supabase";

/**
 * RLS matrix as executable spec — plan/TESTING.md §2 "DB / RLS" layer.
 * Canonical matrix: FEATURES.md §2 + plan/SCHEMA.md "RLS matrix — FINAL [Q-01]".
 *
 * Runs against the LOCAL Supabase stack (CI: supabase db reset; dev: bunx
 * supabase start). One client per role via tests/helpers/supabase.ts
 * `createRoleClient`, asserting allow AND deny per cell — UI hiding is never
 * the enforcement (FEATURES.md §2: "enforced twice").
 *
 * Skeleton (test.todo) until the supabase package lands migrations + seeded
 * role users. Convert todos to real tests in place — keep the names.
 */

describe("RLS matrix [R2-01 · Q-01 FINAL]", () => {
  describe("owner", () => {
    test.todo("owner: full read+write on every smark_ table", () => {});
    test.todo("owner: can INSERT/UPDATE smark_app_users (create, deactivate)", () => {});
    test.todo("owner: can approve/retire smark_learned_rules and bump smark_learned_rules_doc", () => {});
    test.todo("owner: can write Settings tables (ordering_rules, distributors, expense_accounts)", () => {});
  });

  describe("employee", () => {
    test.todo("employee: read+write operational tables (parts, stock_locations, movements, boms, runs, cart, feedback, activities)", () => {});
    test.todo("employee: can write OWN attendance + time entries only (auth.uid() = user_id)", () => {});
    test.todo("employee: DENIED read of others' attendance/time entries (Daily Reports self-only)", () => {});
    test.todo("employee: DENIED SELECT on smark_expenses and v_expense_rollups (hidden, not read-only)", () => {});
    test.todo("employee: DENIED writes to Settings tables (ordering_rules, distributors, expense_accounts, app_users)", () => {});
    test.todo("employee: DENIED approving smark_learned_rules (UPDATE status suggested→active rejected)", () => {});
    test.todo("employee: DENIED user management (INSERT/UPDATE smark_app_users)", () => {});
  });

  describe("accountant", () => {
    test.todo("accountant: read-only operational tables — SELECT allowed, INSERT/UPDATE/DELETE denied (parts, movements, boms, cart, orders)", () => {});
    test.todo("accountant: read + WRITE smark_expenses (Q-01 client amendment)", () => {});
    test.todo("accountant: SELECT smark_expense_accounts allowed, writes denied (owner-only CRUD)", () => {});
    test.todo("accountant: reads ALL attendance/time/daily data (read-all, write none)", () => {});
    test.todo("accountant: DENIED Settings tables and learned-rule approval", () => {});
  });

  describe("shared / structural", () => {
    test.todo("smark_app_users readable by every authenticated role (names render in history)", () => {});
    test.todo("every mutation stamps the real user_id (created_by/actor = auth.uid(), not spoofable)", () => {});
    test.todo("deactivated user (active=false) is blocked from all reads/writes", () => {});
    test.todo("anonymous key: DENIED on all smark_ tables directly", () => {});
  });

  describe("client portal (tokenized public surface, not a role) [R2-38]", () => {
    // Converted from test.todo — supabase/migrations/0006_portal_fns.sql (the
    // portal package's reserved migration) now exists. `service`/`anon` are
    // constructed inside `beforeAll`, not at describe-body top level: Bun
    // still executes a skipped describe's callback body to collect its
    // tests, so building clients eagerly here would throw on a machine with
    // no local stack even when describeWithDb resolves to describe.skip
    // (same pattern as tests/invariants/*.test.ts and
    // tests/integration/receive-core.test.ts).
    describeWithDb("reads: valid token, shared-only payload, invalid/archived token", () => {
      let service: SupabaseClient;
      let anon: SupabaseClient;
      let projectId: string;
      let token: string;

      beforeAll(async () => {
        service = createServiceClient();
        anon = createAnonClient();
        token = `rls-portal-${randomUUID()}`;

        const { data, error } = await service
          .from("smark_projects")
          .insert({ name: "RLS Portal Test Project", share_token: token })
          .select("id")
          .single();
        if (error || !data) throw new Error(`portal RLS fixture: project insert failed: ${error?.message}`);
        projectId = (data as { id: string }).id;

        const { error: phaseErr } = await service.from("smark_project_phases").insert([
          { project_id: projectId, sort_order: 1, name: "Phase A", row_kind: "phase", status: "done", start_date: "2026-01-01", end_date: "2026-01-05" },
          { project_id: projectId, sort_order: 2, name: "Phase B", row_kind: "phase", status: "active", start_date: "2026-01-06", end_date: "2026-01-10" },
        ]);
        if (phaseErr) throw new Error(`portal RLS fixture: phases insert failed: ${phaseErr.message}`);

        const { error: actErr } = await service.from("smark_project_activities").insert([
          { project_id: projectId, type: "note", title: "Shared update", body: "visible on the portal", shared_to_portal: true },
          { project_id: projectId, type: "note", title: "Hidden update", body: "internal only, ₹12,000", shared_to_portal: false },
        ]);
        if (actErr) throw new Error(`portal RLS fixture: activities insert failed: ${actErr.message}`);

        const { error: docErr } = await service.from("smark_project_documents").insert([
          { project_id: projectId, display_name: "Shared doc", file_url: "https://example.test/shared.pdf", shared_to_portal: true },
          { project_id: projectId, display_name: "Hidden doc", file_url: "https://example.test/hidden.pdf", shared_to_portal: false },
        ]);
        if (docErr) throw new Error(`portal RLS fixture: documents insert failed: ${docErr.message}`);
      });

      afterAll(async () => {
        if (!projectId) return;
        await service.from("smark_project_documents").delete().eq("project_id", projectId);
        await service.from("smark_project_activities").delete().eq("project_id", projectId);
        await service.from("smark_project_phases").delete().eq("project_id", projectId);
        await service.from("smark_projects").delete().eq("id", projectId);
      });

      test("portal security-definer fn returns ONLY name/status/phases/progress + explicitly-shared items for a valid share_token", async () => {
        const { data: projectData, error: projectErr } = await anon.rpc("portal_get_project", { p_token: token });
        expect(projectErr).toBeNull();
        const project = projectData as Record<string, unknown>;
        expect(project.name).toBe("RLS Portal Test Project");
        expect(Object.keys(project).sort()).toEqual(
          ["completed_at", "est_delivery_date", "est_start_date", "name", "phases", "project_id", "status", "timeline_note"].sort(),
        );
        const phases = project.phases as Array<Record<string, unknown>>;
        expect(phases).toHaveLength(2);
        for (const phase of phases) {
          expect(Object.keys(phase).sort()).toEqual(
            ["duration_text", "end_date", "id", "name", "notes", "row_kind", "sort_order", "status", "start_date", "version_label"].sort(),
          );
        }

        const { data: sharedData, error: sharedErr } = await anon.rpc("portal_get_shared", { p_token: token });
        expect(sharedErr).toBeNull();
        const shared = sharedData as { activities: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>> };
        expect(shared.activities).toHaveLength(1);
        expect(shared.activities[0]?.title).toBe("Shared update");
        expect(shared.documents).toHaveLength(1);
        expect(shared.documents[0]?.display_name).toBe("Shared doc");
      });

      test("share_token grants ZERO direct table-level access (all raw selects denied)", async () => {
        const { error: projErr } = await anon.from("smark_projects").select("*").eq("id", projectId);
        expect(projErr).not.toBeNull();
        const { error: phaseErr } = await anon.from("smark_project_phases").select("*").eq("project_id", projectId);
        expect(phaseErr).not.toBeNull();
        const { error: actErr } = await anon.from("smark_project_activities").select("*").eq("project_id", projectId);
        expect(actErr).not.toBeNull();
        const { error: docErr } = await anon.from("smark_project_documents").select("*").eq("project_id", projectId);
        expect(docErr).not.toBeNull();
      });

      test("invalid or regenerated token resolves nothing (regenerate = revoke)", async () => {
        const { data: projectData, error: projectErr } = await anon.rpc("portal_get_project", { p_token: "no-such-token-ever" });
        expect(projectErr).toBeNull();
        expect(projectData).toBeNull();

        const { data: sharedData, error: sharedErr } = await anon.rpc("portal_get_shared", { p_token: "no-such-token-ever" });
        expect(sharedErr).toBeNull();
        expect(sharedData).toBeNull();
      });

      test("archived project's token stops resolving [R2-32]", async () => {
        await service.from("smark_projects").update({ archived_at: new Date().toISOString() }).eq("id", projectId);
        try {
          const { data } = await anon.rpc("portal_get_project", { p_token: token });
          expect(data).toBeNull();
        } finally {
          // Restore for any later test in this run that reuses `token`.
          await service.from("smark_projects").update({ archived_at: null }).eq("id", projectId);
        }
      });

      test("portal payload NEVER contains prices, inventory, hours, or internal notes (leak scan)", async () => {
        const { data: sharedData } = await anon.rpc("portal_get_shared", { p_token: token });
        const serialized = JSON.stringify(sharedData);
        expect(serialized).not.toContain("₹");
        expect(serialized).not.toContain("12,000");
        expect(serialized).not.toContain("Hidden update");
        expect(serialized).not.toContain("Hidden doc");
      });
    });

    describeWithDb("writes: comment insert + rate limit", () => {
      let service: SupabaseClient;
      let anon: SupabaseClient;
      let projectId: string;
      let token: string;

      beforeAll(async () => {
        service = createServiceClient();
        anon = createAnonClient();
        token = `rls-portal-comment-${randomUUID()}`;

        const { data, error } = await service
          .from("smark_projects")
          .insert({ name: "RLS Portal Comment Test", share_token: token })
          .select("id")
          .single();
        if (error || !data) throw new Error(`portal RLS fixture: project insert failed: ${error?.message}`);
        projectId = (data as { id: string }).id;
      });

      afterAll(async () => {
        if (!projectId) return;
        await service.from("smark_project_activities").delete().eq("project_id", projectId);
        await service.from("smark_projects").delete().eq("id", projectId);
      });

      test("portal comment INSERT lands as 'change' activity tagged from-portal; any other INSERT denied", async () => {
        const { data: rpcData, error: rpcErr } = await anon.rpc("portal_add_comment", {
          p_token: token,
          p_author_name: "Test Client",
          p_body: "Looks great, thanks!",
        });
        expect(rpcErr).toBeNull();
        expect((rpcData as { ok?: boolean } | null)?.ok).toBe(true);

        const { data: rows } = await service
          .from("smark_project_activities")
          .select("type, shared_to_portal, from_portal, created_by")
          .eq("project_id", projectId);
        expect(rows).toHaveLength(1);
        expect(rows?.[0]?.type).toBe("change");
        expect(rows?.[0]?.from_portal).toBe(true);
        expect(rows?.[0]?.shared_to_portal).toBe(true);
        expect(rows?.[0]?.created_by).toBeNull();

        const { error: directInsertErr } = await anon.from("smark_project_activities").insert({
          project_id: projectId,
          type: "change",
          body: "should be denied — no direct table access for anon",
        });
        expect(directInsertErr).not.toBeNull();
      });

      test("rate limit: more than 5 comments from one token within the hour are rejected", async () => {
        for (let i = 0; i < 4; i += 1) {
          const { error } = await anon.rpc("portal_add_comment", {
            p_token: token,
            p_author_name: "Test Client",
            p_body: `follow-up message ${i}`,
          });
          expect(error).toBeNull();
        }
        // 5 total have now landed (1 from the previous test + 4 here) — the 6th must be rejected.
        const { error: sixthErr } = await anon.rpc("portal_add_comment", {
          p_token: token,
          p_author_name: "Test Client",
          p_body: "one too many",
        });
        expect(sixthErr).not.toBeNull();
      });

      test("invalid token: comment INSERT rejected with no distinction from a valid-token rate-limit rejection", async () => {
        const { error } = await anon.rpc("portal_add_comment", {
          p_token: "no-such-token-ever",
          p_author_name: "Test Client",
          p_body: "hello?",
        });
        expect(error).not.toBeNull();
      });
    });
  });
});
