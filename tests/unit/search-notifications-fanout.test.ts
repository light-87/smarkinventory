import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notify,
  notifyArrival,
  notifyExpenseDraft,
  notifyLowStock,
  notifyPortalComment,
  notifyRulePending,
  notifyRunDone,
  notifyTaskAssigned,
} from "@/lib/notifications/fanout";
import { TABLES, type Database } from "@/types/db";

/**
 * lib/notifications/fanout — the fan-out helpers cart-orders / projects-hub /
 * ai-memory / portal import (docs/OWNERSHIP.md cross-package allowance;
 * FEATURES.md §5 header spec's event list). Exercised against a small
 * hand-rolled fake of the PostgREST insert/select chain these call — same
 * local-fake convention as tests/unit/scan-resolve.test.ts (docs/OWNERSHIP.md
 * reserves tests/helpers/** for the integrator).
 */

describe("notify — the low-level fan-out primitive", () => {
  test("inserts one row per unique recipient, deduping repeated ids", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    const rows = await notify(client, {
      userIds: ["owner-1", "owner-1", "employee-1"],
      kind: "low_stock",
      title: "Test title",
      body: "Test body",
      link: "/inventory",
    });
    expect(rows).toHaveLength(2);
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.user_id).sort()).toEqual(["employee-1", "owner-1"]);
  });

  test("an empty recipient list inserts nothing", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    const rows = await notify(client, { userIds: [], kind: "low_stock", title: "x" });
    expect(rows).toEqual([]);
    expect(notifications).toHaveLength(0);
  });
});

describe("per-event helpers — audience + deep link", () => {
  test("notifyTaskAssigned targets only the named assignee, linking into the project", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    const row = await notifyTaskAssigned(client, {
      projectId: "proj-1",
      projectName: "Acme Widget",
      taskTitle: "Solder the prototype",
      assigneeUserId: "employee-1",
    });
    expect(row.user_id).toBe("employee-1");
    expect(row.kind).toBe("task_assigned");
    expect(row.link).toBe("/projects/proj-1");
    expect(notifications).toHaveLength(1);
  });

  test("notifyArrival targets the order's placer, linking into the cart's order group", async () => {
    const { client } = makeFakeClient(fixtures());
    const row = await notifyArrival(client, {
      orderId: "order-1",
      poNumber: "PO-2026-001",
      distributorName: "Mouser",
      recipientUserId: "employee-1",
    });
    expect(row.user_id).toBe("employee-1");
    expect(row.kind).toBe("arrival");
    expect(row.link).toBe("/cart?order=order-1");
    expect(row.title).toContain("PO-2026-001");
  });

  test("notifyRunDone targets whoever started the run, linking into the BOM's runs", async () => {
    const { client } = makeFakeClient(fixtures());
    const row = await notifyRunDone(client, {
      projectId: "proj-1",
      bomId: "bom-1",
      startedByUserId: "employee-1",
      actualCost: 1234.5,
    });
    expect(row.user_id).toBe("employee-1");
    expect(row.kind).toBe("run_done");
    expect(row.link).toBe("/projects/proj-1/runs?bom=bom-1");
    expect(row.body).toContain("1234.50");
  });

  test("notifyRulePending fans out to every ACTIVE owner only", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    await notifyRulePending(client, { ruleSummary: "Prefer Mouser for capacitors" });
    // owner-1 is active, owner-2 (inactive) and employee-1 must NOT be notified.
    expect(notifications.map((n) => n.user_id)).toEqual(["owner-1"]);
    expect(notifications[0]?.kind).toBe("rule_pending");
    expect(notifications[0]?.link).toBe("/ai-memory");
  });

  test("notifyLowStock fans out to owners and links to the part", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    await notifyLowStock(client, { pid: "SMK-000101", description: "0.1uF cap", totalQty: 3, reorderPoint: 50 });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.link).toBe("/part/SMK-000101");
    expect(notifications[0]?.body).toContain("reorder point 50");
  });

  test("notifyExpenseDraft fans out to owners with the ₹ amount in the body", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    await notifyExpenseDraft(client, { poNumber: "PO-2026-001", amount: 4500 });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.kind).toBe("expense_draft");
    expect(notifications[0]?.link).toBe("/expenses");
    expect(notifications[0]?.body).toContain("4500.00");
  });

  test("notifyPortalComment fans out to owners, linking into the project", async () => {
    const { client, notifications } = makeFakeClient(fixtures());
    await notifyPortalComment(client, {
      projectId: "proj-1",
      projectName: "Acme Widget",
      commentSnippet: "When can we expect delivery?",
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.kind).toBe("portal_comment");
    expect(notifications[0]?.link).toBe("/projects/proj-1");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Minimal fake Supabase client — just enough of the insert/select/eq chain
 * lib/notifications/fanout.ts actually calls. Local to this file per
 * docs/OWNERSHIP.md ("tests/helpers/** reserved for the integrator").
 * ──────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

interface Fixtures {
  appUsers: Row[];
}

function fixtures(): Fixtures {
  return {
    appUsers: [
      { id: "owner-1", role: "owner", active: true },
      { id: "owner-2", role: "owner", active: false }, // deactivated — must never be notified
      { id: "employee-1", role: "employee", active: true },
    ],
  };
}

class FakeAppUsersQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private cols = "*";
  constructor(private readonly rows: Row[]) {}

  select(cols: string) {
    this.cols = cols;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((row) => row[col] === val);
    return this;
  }
  then<T1 = unknown, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    const matched = this.rows.filter((row) => this.filters.every((f) => f(row)));
    return Promise.resolve({ data: matched, error: null }).then(onfulfilled, onrejected);
  }
}

class FakeNotificationsInsert {
  private cols = "*";
  constructor(
    private readonly store: Row[],
    private readonly rowsToInsert: Row[],
  ) {}

  select(cols: string) {
    this.cols = cols;
    return this;
  }
  then<T1 = unknown, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    const inserted = this.rowsToInsert.map((row, i) => ({
      id: `notif-${this.store.length + i + 1}`,
      created_at: new Date().toISOString(),
      updated_at: null,
      read_at: null,
      body: null,
      link: null,
      ...row,
    }));
    this.store.push(...inserted);
    return Promise.resolve({ data: inserted, error: null }).then(onfulfilled, onrejected);
  }
}

class FakeNotificationsTable {
  constructor(private readonly store: Row[]) {}
  insert(rows: Row[]) {
    return new FakeNotificationsInsert(this.store, rows);
  }
}

function makeFakeClient(fx: Fixtures): { client: SupabaseClient<Database>; notifications: Row[] } {
  const notifications: Row[] = [];
  const from = (table: string) => {
    switch (table) {
      case TABLES.app_users:
        return new FakeAppUsersQuery(fx.appUsers);
      case TABLES.notifications:
        return new FakeNotificationsTable(notifications);
      default:
        throw new Error(`fake client: unexpected table "${table}"`);
    }
  };
  return { client: { from } as unknown as SupabaseClient<Database>, notifications };
}
