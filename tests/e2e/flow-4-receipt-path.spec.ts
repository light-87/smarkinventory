import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/format";
import { MOCK_DEMO_RECEIPT_TEXT } from "@/lib/ai/client";

/**
 * E2E FLOW-4 — the receipt path (plan/TESTING.md §3.4): upload the receipt
 * fixture on an ordered group → "Extract prices" (mocked) proposes → confirm
 * → order line price (+ eventually the part's `last_unit_price`, once put
 * away) updated. The dialog's own confirm step is the ONLY place a price is
 * ever written (lib/orders/receipt-extract.ts module doc, FEATURES §12/§20
 * risk #3 "always user-confirmed, never silent writes") — this suite asserts
 * that literally: nothing changes between "Extract prices" and "Confirm".
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts.
 *
 * Distinct fixture from tests/e2e/cart-smoke.spec.ts's own receipt-extraction
 * test (same MOCK_DEMO_RECEIPT_TEXT marker, different PO number so the two
 * files never collide on `smark_orders.po_number`'s UNIQUE constraint) —
 * that file's fixture cart item/order line is deliberately un-catalogued
 * (`part_id: null`), which can never prove `smark_parts.last_unit_price`
 * moves. This file's fixture links a REAL catalogued part (mpn
 * `STM32F103C8T6`, the mock receipt's first line) so it can carry the
 * corrected price all the way through to a put-away and assert the part's
 * own `last_unit_price` — proving the receipt CORRECTION (not just whatever
 * price checkout happened to record) is what ends up stamped.
 */
if (typeof process.versions.bun === "undefined") {
  function tag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  interface ReceiptFlowFixture {
    poNumber: string;
    partId: string;
    internalPid: string;
    orderId: string;
    orderLineId: string;
    cartItemId: string;
  }

  const EXPECTED_STM32_PRICE = 42.5; // lib/ai/client.ts MOCK_DEMO_RECEIPT_FIXTURE's STM32F103C8T6 line

  async function seedFixture(runTag: string): Promise<ReceiptFlowFixture> {
    const service = createServiceClient();

    const shelf = await service.from("smark_shelves").insert({ code: `F4-${runTag}` }).select("id").single();
    if (shelf.error || !shelf.data) throw new Error(`seed shelf failed: ${shelf.error?.message}`);
    const box = await service
      .from("smark_big_boxes")
      .insert({ shelf_id: shelf.data.id, name: `BOX-F4-${runTag}` })
      .select("id")
      .single();
    if (box.error || !box.data) throw new Error(`seed box failed: ${box.error?.message}`);

    // Real catalogued part, unpriced — the receipt's mpn line matches it exactly.
    const part = await service
      .from("smark_parts")
      .insert({
        internal_pid: `SMKTEST-F4-${runTag}`,
        mpn: "STM32F103C8T6",
        category: "IC",
        value: "STM32F103C8T6",
        package: "LQFP48",
        attributes: {},
      })
      .select("id, internal_pid")
      .single();
    if (part.error || !part.data) throw new Error(`seed part failed: ${part.error?.message}`);

    const location = await service
      .from("smark_stock_locations")
      .insert({ part_id: part.data.id, big_box_id: box.data.id, qty: 3 });
    if (location.error) throw new Error(`seed stock location failed: ${location.error.message}`);

    const distributor = await service.from("smark_distributors").select("id").eq("name", "Digikey").single();
    if (distributor.error || !distributor.data) throw new Error(`"Digikey" isn't seeded: ${distributor.error?.message}`);

    const owner = await service.from("smark_app_users").select("id").eq("username", "owner").single();
    if (owner.error || !owner.data) throw new Error(`seeded "owner" user not found: ${owner.error?.message}`);

    const poNumber = `E2E-FLOW4-${runTag}`;
    const order = await service
      .from("smark_orders")
      .insert({ distributor_id: distributor.data.id, po_number: poNumber, placed_by: owner.data.id, status: "ordered" })
      .select("id")
      .single();
    if (order.error || !order.data) throw new Error(`seed order failed: ${order.error?.message}`);

    const cartItem = await service
      .from("smark_cart_items")
      .insert({
        part_id: part.data.id,
        descriptor: null,
        source: "manual",
        demand: [],
        qty_to_order: 100,
        unit_price: null,
        status: "ordered",
        created_by: owner.data.id,
      })
      .select("id")
      .single();
    if (cartItem.error || !cartItem.data) throw new Error(`seed cart item failed: ${cartItem.error?.message}`);

    const orderLine = await service
      .from("smark_order_lines")
      .insert({
        order_id: order.data.id,
        cart_item_id: cartItem.data.id,
        part_id: part.data.id,
        chosen_distributor_id: distributor.data.id,
        qty_ordered: 100,
        unit_price: null,
        line_status: "ordered",
      })
      .select("id")
      .single();
    if (orderLine.error || !orderLine.data) throw new Error(`seed order line failed: ${orderLine.error?.message}`);

    return {
      poNumber,
      partId: part.data.id as string,
      internalPid: part.data.internal_pid as string,
      orderId: order.data.id as string,
      orderLineId: orderLine.data.id as string,
      cartItemId: cartItem.data.id as string,
    };
  }

  test.describe("flow-4: receipt path [E2E, owner]", () => {
    test("upload → extract (mock, read-only) → confirm → order line + part last_unit_price updated", async ({ page }) => {
      test.setTimeout(90_000);

      const runTag = tag();
      const service = createServiceClient();
      const fixture = await seedFixture(runTag);

      await loginAsOwner(page);
      await page.goto("/cart");
      await page.getByRole("radio", { name: /^Ordered \(\d+\)$/ }).click();

      // Generous (15s, not this suite's 5s default) timeouts on
      // Server-Action-triggered re-renders from here on — see
      // tests/e2e/flow-3-ordering-pipeline.spec.ts's header comment on the
      // same convention (this repo's e2e run shares ONE `next dev` process
      // and one local Supabase stack across every spec/agent running
      // concurrently).
      const group = page.locator(".rounded-2xl", { hasText: `PO ${fixture.poNumber}` }).first();
      await expect(group).toBeVisible({ timeout: 15_000 });

      await test.step("upload the mock demo receipt", async () => {
        await group.getByRole("button", { name: /^(upload|replace) receipt$/i }).click();
        await group.locator('input[type="file"]').setInputFiles({
          name: "receipt-demo.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(MOCK_DEMO_RECEIPT_TEXT, "utf8"),
        });
        await expect(group.getByText("Receipt attached")).toBeVisible({ timeout: 15_000 });
      });

      const dialog = page.getByRole("dialog", { name: "Confirm extracted receipt prices" });
      await test.step("extract prices (read-only) proposes a mapping", async () => {
        await group.getByRole("button", { name: /extract prices/i }).click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("MPN match")).toBeVisible();
        await expect(dialog.locator(".truncate.text-snow", { hasText: "STM32F103C8T6" })).toBeVisible();
      });

      await test.step("assert NOTHING was written before confirm", async () => {
        const orderLine = await service
          .from("smark_order_lines")
          .select("unit_price")
          .eq("id", fixture.orderLineId)
          .single();
        if (orderLine.error) throw new Error(orderLine.error.message);
        expect(orderLine.data.unit_price).toBeNull();

        const cartItem = await service.from("smark_cart_items").select("unit_price").eq("id", fixture.cartItemId).single();
        if (cartItem.error) throw new Error(cartItem.error.message);
        expect(cartItem.data.unit_price).toBeNull();

        const part = await service.from("smark_parts").select("last_unit_price").eq("id", fixture.partId).single();
        if (part.error) throw new Error(part.error.message);
        expect(part.data.last_unit_price).toBeNull();
      });

      await test.step("confirm writes the corrected price — the only write in this whole flow", async () => {
        await dialog.getByRole("button", { name: /confirm.*apply prices/i }).click();
        await expect(page.getByText(/updated \d+ order line/i)).toBeVisible({ timeout: 15_000 });
        await expect(dialog).not.toBeVisible();

        // This order has exactly one line (100 × ₹42.50) — total is unambiguous.
        await expect(group.getByText("₹4,250.00")).toBeVisible({ timeout: 15_000 });

        const orderLine = await service
          .from("smark_order_lines")
          .select("unit_price")
          .eq("id", fixture.orderLineId)
          .single();
        if (orderLine.error) throw new Error(orderLine.error.message);
        expect(orderLine.data.unit_price).toBeCloseTo(EXPECTED_STM32_PRICE, 5);

        const cartItem = await service.from("smark_cart_items").select("unit_price").eq("id", fixture.cartItemId).single();
        if (cartItem.error) throw new Error(cartItem.error.message);
        expect(cartItem.data.unit_price).toBeCloseTo(EXPECTED_STM32_PRICE, 5);

        // last_unit_price only ever stamps at put-away (lib/receive/core.ts) —
        // the correction hasn't reached the catalog part yet.
        const part = await service.from("smark_parts").select("last_unit_price").eq("id", fixture.partId).single();
        if (part.error) throw new Error(part.error.message);
        expect(part.data.last_unit_price).toBeNull();
      });

      await test.step("mark arrived, then put away — the corrected price flows to the part", async () => {
        await group.getByRole("button", { name: /mark arrived/i }).click();
        await expect(group.getByRole("button", { name: /mark arrived/i })).toBeHidden({ timeout: 15_000 });

        await page.goto("/receive?card=put-away");
        const arrivedLine = page.getByRole("button").filter({ hasText: fixture.internalPid });
        await expect(arrivedLine).toBeVisible({ timeout: 15_000 });
        await arrivedLine.click();
        await page.getByRole("button", { name: /confirm.*put away/i }).click();
        await expect(page.getByText(new RegExp(`Put away 100 . ${fixture.internalPid}`))).toBeVisible({ timeout: 15_000 });

        const part = await service.from("smark_parts").select("last_unit_price").eq("id", fixture.partId).single();
        if (part.error) throw new Error(part.error.message);
        expect(part.data.last_unit_price).toBeCloseTo(EXPECTED_STM32_PRICE, 5);
      });

      await test.step("part drawer shows the corrected last price", async () => {
        await page.goto(`/part/${fixture.internalPid}`);
        await expect(page.getByText("Last price")).toBeVisible();
        await expect(page.getByText(formatINR(EXPECTED_STM32_PRICE))).toBeVisible();
      });
    });
  });
}
