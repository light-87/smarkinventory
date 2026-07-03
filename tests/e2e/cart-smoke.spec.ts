import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { MOCK_DEMO_RECEIPT_TEXT } from "@/lib/ai/client";

/**
 * E2E — Cart surface smoke (plan/tab-on-order.md · FEATURES.md §5.12 ·
 * plan/TESTING.md §3 E2E-3).
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts:
 * `bun test` globs `*.spec.ts` too, so this file no-ops under the Bun
 * runtime and only really runs via `bunx playwright test`.
 *
 * The canonical demo seed (scripts/seed-canonical-demo.ts) deliberately
 * doesn't guarantee fixed part PIDs (falls back when its intended
 * `SMK-0001NN` range is taken) and seeds no projects/BOMs/orders at all —
 * bom-pipeline/projects-hub own creating those. So the deeper interactive
 * flows (manual-add search → add, checkout → PO number → confirm, mark
 * arrived → Receive hand-off) are `test.fixme()` here, same convention
 * tests/e2e/receive-receive.spec.ts uses for its own not-yet-fixture-backed
 * flows — this file's real (non-fixme) coverage is chrome/access, mirroring
 * tests/e2e/dashboard-smoke.spec.ts. The one exception is the WF-3 "Extract
 * prices" flow below, which seeds its own already-placed order directly via
 * the service-role client (same pattern tests/e2e/bom-upload.spec.ts uses
 * for its fixture project — checkout itself isn't exercisable here yet, but
 * an order to extract a receipt against doesn't need checkout to exist).
 */
if (typeof process.versions.bun === "undefined") {
  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Same cold-Turbopack-compile headroom as tests/e2e/dashboard-smoke.spec.ts.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  interface ReceiptFixtureOrder {
    poNumber: string;
  }

  /**
   * Idempotently seeds ONE already-placed order (Digikey, one line: MPN
   * `STM32F103C8T6` × 100, unpriced) to extract the mock demo receipt
   * against — looked up by its fixed PO number first so reruns don't pile up
   * duplicates. `STM32F103C8T6` is also the first line of
   * `MOCK_DEMO_RECEIPT_TEXT` (lib/ai/client.ts), so this exercises the exact
   * MPN rung of lib/orders/receipt-map.ts, not just the fuzzy fallback.
   */
  async function ensureReceiptFixtureOrder(): Promise<ReceiptFixtureOrder> {
    const supabase = createServiceClient();
    const poNumber = "E2E-RECEIPT-0001";

    const existingOrder = await supabase.from("smark_orders").select("id").eq("po_number", poNumber).maybeSingle();
    if (existingOrder.error) throw new Error(`Could not look up the fixture order: ${existingOrder.error.message}`);
    let orderId = existingOrder.data?.id as string | undefined;

    if (orderId) {
      const existingLine = await supabase
        .from("smark_order_lines")
        .select("id")
        .eq("order_id", orderId)
        .limit(1)
        .maybeSingle();
      if (existingLine.data) return { poNumber };
    }

    const distributor = await supabase.from("smark_distributors").select("id").eq("name", "Digikey").single();
    if (distributor.error || !distributor.data) {
      throw new Error(`"Digikey" isn't seeded (supabase/seed.sql): ${distributor.error?.message ?? "no row"}`);
    }

    const owner = await supabase.from("smark_app_users").select("id").eq("username", "owner").single();
    if (owner.error || !owner.data) throw new Error(`Seeded "owner" user not found: ${owner.error?.message ?? "no row"}`);

    if (!orderId) {
      const created = await supabase
        .from("smark_orders")
        .insert({ distributor_id: distributor.data.id, po_number: poNumber, placed_by: owner.data.id, status: "ordered" })
        .select("id")
        .single();
      if (created.error || !created.data) {
        throw new Error(`Could not seed the fixture order: ${created.error?.message ?? "no row returned"}`);
      }
      orderId = created.data.id as string;
    }

    const cartItem = await supabase
      .from("smark_cart_items")
      .insert({
        part_id: null,
        descriptor: { mpn: "STM32F103C8T6" },
        source: "manual",
        demand: [],
        qty_to_order: 100,
        status: "ordered",
        created_by: owner.data.id,
      })
      .select("id")
      .single();
    if (cartItem.error || !cartItem.data) {
      throw new Error(`Could not seed the fixture cart item: ${cartItem.error?.message ?? "no row returned"}`);
    }

    const orderLine = await supabase.from("smark_order_lines").insert({
      order_id: orderId,
      cart_item_id: cartItem.data.id,
      part_id: null,
      chosen_distributor_id: distributor.data.id,
      qty_ordered: 100,
      unit_price: null,
      line_status: "ordered",
    });
    if (orderLine.error) throw new Error(`Could not seed the fixture order line: ${orderLine.error.message}`);

    return { poNumber };
  }

  test.describe("Cart — no session", () => {
    test("visiting /cart while signed out redirects to /login, not a crash", async ({ page }) => {
      const response = await page.goto("/cart");
      expect(response?.ok(), "/cart responds 2xx even signed out").toBeTruthy();
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    });
  });

  test.describe("Cart — chrome", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page);
    });

    test("boots and renders its three sections (Cart / Ordered / Arrived)", async ({ page }) => {
      const response = await page.goto("/cart");
      expect(response?.ok(), "/cart responds 2xx").toBeTruthy();

      await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Cart \(\d+\)$/ })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Ordered \(\d+\)$/ })).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Arrived \(\d+\)$/ })).toBeVisible();
    });

    test("switching to Ordered/Arrived never crashes, empty or not", async ({ page }) => {
      // Was "...even with nothing placed yet" asserting the literal empty-state
      // copy — no longer safe to assume on a DB that's ever had this suite's
      // receipt-extraction fixture order (below) seeded into it. What this
      // test actually cares about is "the tab switch renders SOMETHING sane,
      // not a crash", so it accepts either the empty state or a real PO card.
      // `.first()` on both: this DB can carry several fixture orders in the
      // same status at once (this suite's own receipt-extraction fixture,
      // plus other specs' — e.g. flow-3/flow-4 — leftover POs), so
      // `getByText(/^PO /)` routinely matches more than one card. The check
      // only cares that SOME sane content rendered on the tab switch, not
      // which card — `.first()` keeps that intent without a strict-mode
      // violation when more than one match is present.
      await page.goto("/cart");
      await page.getByRole("radio", { name: /^Ordered \(\d+\)$/ }).click();
      await expect(page.getByText(/nothing on order/i).or(page.getByText(/^PO /)).first()).toBeVisible();

      await page.getByRole("radio", { name: /^Arrived \(\d+\)$/ }).click();
      await expect(page.getByText(/nothing arrived yet/i).or(page.getByText(/^PO /)).first()).toBeVisible();
    });

    test("no horizontal scroll at the mobile breakpoint", async ({ page }) => {
      await page.goto("/cart");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });

  test.describe("Cart — manual add [E2E-3]", () => {
    test.fixme("searching an existing part and adding a qty creates an open cart line with that qty", async () => {});
    test.fixme("adding a part already in the cart bumps its qty instead of creating a second line", async () => {});
  });

  test.describe("Cart — smart shortfall [E2E-3, client's permanent example]", () => {
    test.fixme(
      "a part with 500 in stock demanded 400+200 across two active project BOMs shows an auto cart line of exactly 100",
      async () => {},
    );
    test.fixme("dismissing an auto-shortfall line removes it from the open list until the shortfall grows", async () => {});
  });

  test.describe("Cart — checkout [E2E-3, Q-06]", () => {
    test.fixme("selecting lines groups them by distributor at checkout, one PO-number field per group", async () => {});
    test.fixme("confirming with a PO number places the order and moves its lines out of the open cart", async () => {});
    test.fixme("a distributor group left without a PO number stays in the cart after confirming the others", async () => {});
  });

  test.describe("Cart — Ordered/Arrived [E2E-3]", () => {
    test.fixme("marking a line arrived moves it from Ordered to Arrived without affecting sibling lines' status", async () => {});
    test.fixme("the Arrived tab links to Receive's put-away queue when a line hasn't been put away yet", async () => {});
  });

  test.describe("Cart — receipt extraction [WF-3, owner]", () => {
    test("upload → extract (mock) → confirm fills the MPN-matched line's price and PO total", async ({ page }) => {
      const fixture = await ensureReceiptFixtureOrder();

      await loginAsOwner(page);
      await page.goto("/cart");
      await page.getByRole("radio", { name: /^Ordered \(\d+\)$/ }).click();

      const group = page.locator(".rounded-2xl", { hasText: `PO ${fixture.poNumber}` });
      await expect(group).toBeVisible();

      // 1. Upload the mock demo receipt (in-memory — no fixture file on disk,
      // so there's no risk of it drifting from lib/ai/client.ts's fixture text).
      await group.getByRole("button", { name: /^(upload|replace) receipt$/i }).click();
      await group.locator('input[type="file"]').setInputFiles({
        name: "receipt-demo.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(MOCK_DEMO_RECEIPT_TEXT, "utf8"),
      });
      await expect(group.getByText("Receipt attached")).toBeVisible();

      // 2. Extract (MockAdapter recognizes the marker text and returns the
      // deterministic demo fixture — no live key, no network — lib/ai/client.ts).
      await group.getByRole("button", { name: /extract prices/i }).click();

      // The mock demo receipt has 3 lines (STM32F103C8T6, a resistor, a
      // capacitor); this fixture order only has the STM32 line, so the other
      // two come back "Unmatched" — every one of their <select>s still LISTS
      // "STM32F103C8T6" as an option (the dropdown offers every group,
      // matched or not), so assertions below scope to the row's own
      // description text, not just "contains STM32F103C8T6" anywhere in the dialog.
      const dialog = page.getByRole("dialog", { name: "Confirm extracted receipt prices" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("MPN match")).toBeVisible();
      await expect(dialog.locator(".truncate.text-snow", { hasText: "STM32F103C8T6" })).toBeVisible();

      // 3. Confirm — this is the ONLY step that writes a price (never the extract call itself).
      await dialog.getByRole("button", { name: /confirm.*apply prices/i }).click();
      await expect(page.getByText(/updated \d+ order line/i)).toBeVisible();
      await expect(dialog).not.toBeVisible();

      // The order's line unit_price was null before confirming — this order
      // has exactly one line (100 × ₹42.50), so its total is now unambiguous.
      await expect(group.getByText("₹4,250.00")).toBeVisible();
    });
  });
}
