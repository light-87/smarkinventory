import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createServiceClient } from "@/lib/supabase/server";
import { computeInventoryValue } from "@/lib/dashboard/compute";
import { formatINR } from "@/lib/format";

/**
 * E2E FLOW-3 — the full ordering pipeline (plan/TESTING.md §3.3, the "big
 * one"): create project → create BOM in-app (custom column) → build_qty ×N
 * reconcile flip → run ordering (mock agents) → persisted review → add to
 * cart → the client's permanent shortfall example (500 avail / 400+200 →
 * exactly 100) → checkout (PO required, grouped by distributor) → draft
 * expense → mark arrived → put away → `last_unit_price` stamped → dashboard
 * inventory value reflects it.
 *
 * Same Bun-vs-Playwright self-exclusion guard as tests/e2e/smoke.spec.ts —
 * `bun test` globs `*.spec.ts` too, so this file no-ops under the Bun
 * runtime and only really runs via `bunx playwright test`.
 *
 * Fixtures are seeded directly via the service-role client (same inlined
 * pattern as tests/e2e/ordering-run-review.spec.ts / bom-upload.spec.ts /
 * cart-smoke.spec.ts) for anything the UI itself can't reach yet or that
 * would make the flow non-deterministic — a low-stock catalog part (so
 * bumping build_qty flips its BOM line from in-stock to to-order) and the
 * second/third "shortfall" project+BOM pair the client's own 500/400+200
 * example needs (creating THOSE via the full BOM UI is out of scope for
 * what this flow is actually testing — the shortfall view, not a second
 * reconcile). Every fixture name/PID is tagged with a per-run-unique suffix
 * (timestamp + random) so two concurrent workers (this file runs on BOTH
 * `desktop-1280` and `mobile-360` per playwright.config.ts, often in
 * parallel against the SAME local Supabase stack) never collide.
 *
 * Mock-mode determinism: mirrors ordering-run-review.spec.ts exactly — the
 * BOM's `distributor_sequence` is patched (service-role) to enable ONLY
 * "LCSC" (a "browse"-type distributor with no BrowserDriver configured in
 * the drain script) so a job never reaches a Digikey/Mouser/element14 REST
 * client, which would throw in replay mode with no recorded fixture.
 */
if (typeof process.versions.bun === "undefined") {
  function tag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function serviceClient() {
    return createServiceClient();
  }

  async function loginAsOwner(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#login-username").fill("owner");
    await page.locator("#login-password").fill("Owner@12345");
    await page.getByRole("button", { name: /log in/i }).click();
    // Same generous cold-Turbopack-compile headroom as tests/e2e/dashboard-smoke.spec.ts.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  }

  /** Same drain mechanism tests/e2e/ordering-run-review.spec.ts uses — ticks the worker's poll loop synchronously so a mock run reaches a terminal status. */
  function drainAgentRuns(): void {
    const repoRoot = path.resolve(__dirname, "..", "..");
    execFileSync("bun", ["run", "scripts/e2e-drain-agent-runs.ts"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
      timeout: 30_000,
    });
  }

  /** Shared shelf + big box for every part this suite seeds directly. */
  async function createTestBox(service: ReturnType<typeof serviceClient>, runTag: string) {
    const shelf = await service.from("smark_shelves").insert({ code: `T${runTag}` }).select("id").single();
    if (shelf.error || !shelf.data) throw new Error(`seed shelf failed: ${shelf.error?.message}`);
    const box = await service
      .from("smark_big_boxes")
      .insert({ shelf_id: shelf.data.id, name: `BOX-${runTag}` })
      .select("id")
      .single();
    if (box.error || !box.data) throw new Error(`seed box failed: ${box.error?.message}`);
    return box.data.id as string;
  }

  /** A catalogued `smark_parts` row with `qty` on hand (via a real `smark_stock_locations` row — `total_qty` is trigger-maintained, never written directly). */
  async function createCatalogPart(
    service: ReturnType<typeof serviceClient>,
    boxId: string,
    input: { internalPid: string; mpn: string; qty: number; category: string; value: string; pkg: string },
  ) {
    const part = await service
      .from("smark_parts")
      .insert({
        internal_pid: input.internalPid,
        mpn: input.mpn,
        category: input.category,
        value: input.value,
        package: input.pkg,
        attributes: {},
      })
      .select("id, internal_pid")
      .single();
    if (part.error || !part.data) throw new Error(`seed part failed: ${part.error?.message}`);

    const location = await service
      .from("smark_stock_locations")
      .insert({ part_id: part.data.id, big_box_id: boxId, qty: input.qty });
    if (location.error) throw new Error(`seed stock location failed: ${location.error.message}`);

    return { id: part.data.id as string, internalPid: part.data.internal_pid as string, mpn: input.mpn };
  }

  /**
   * The client's permanent shortfall example (FEATURES.md §16 / SCHEMA.md
   * `v_part_demand` comment): one part with 500 available, demanded 400 by
   * one active project's BOM and 200 by another's → `v_part_demand.shortfall`
   * = GREATEST(600 − 500, 0) = exactly 100. Seeded straight at the
   * `smark_bom_lines` level (matched_part_id set directly) — this flow is
   * verifying the CART's shortfall view, not a second reconcile pass.
   */
  async function seedShortfallDemand(service: ReturnType<typeof serviceClient>, boxId: string, runTag: string) {
    const part = await createCatalogPart(service, boxId, {
      internalPid: `SMKTEST-SF-${runTag}`,
      mpn: `E2EFLOW3-SF-${runTag}`,
      qty: 500,
      category: "Resistor",
      value: "1k",
      pkg: "0402",
    });

    async function seedDemandBom(name: string, qty: number) {
      const project = await service
        .from("smark_projects")
        .insert({ name: `${name} ${runTag}` })
        .select("id")
        .single();
      if (project.error || !project.data) throw new Error(`seed shortfall project failed: ${project.error?.message}`);

      const bom = await service
        .from("smark_boms")
        .insert({ project_id: project.data.id, name: `Shortfall BOM ${runTag}`, build_qty: 1 })
        .select("id")
        .single();
      if (bom.error || !bom.data) throw new Error(`seed shortfall BOM failed: ${bom.error?.message}`);

      const line = await service.from("smark_bom_lines").insert({
        bom_id: bom.data.id,
        line_no: 1,
        references: "R1",
        qty,
        dnp: false,
        matched_part_id: part.id,
        match_state: "to_order",
      });
      if (line.error) throw new Error(`seed shortfall BOM line failed: ${line.error.message}`);
    }

    // 400 + 200 demanded against 500 available — exactly the client's own example.
    await seedDemandBom("Shortfall Project A", 400);
    await seedDemandBom("Shortfall Project B", 200);

    return part;
  }

  test.describe("flow-3: full ordering pipeline [E2E, owner]", () => {
    test("project → BOM (custom column) → reconcile flip → run → review → cart shortfall → checkout → receive → last price → dashboard", async ({
      page,
    }) => {
      test.setTimeout(240_000);

      const runTag = tag();
      const service = serviceClient();

      // ── Fixtures ──────────────────────────────────────────────────────────
      const boxId = await test.step("seed fixtures (shared box, low-stock part, canonical shortfall)", async () => {
        const sharedBoxId = await createTestBox(service, runTag);
        return sharedBoxId;
      });

      const lowStockPart = await createCatalogPart(service, boxId, {
        internalPid: `SMKTEST-LS-${runTag}`,
        mpn: `E2EFLOW3-LS-${runTag}`,
        qty: 8,
        category: "Capacitor",
        value: "10uF",
        pkg: "0603",
      });

      const shortfallPart = await seedShortfallDemand(service, boxId, runTag);

      const { data: distributors, error: distError } = await service.from("smark_distributors").select("id, name");
      if (distError || !distributors?.length) throw new Error(`smark_distributors isn't seeded: ${distError?.message}`);

      await loginAsOwner(page);

      // ── 1. Create project (UI) ──────────────────────────────────────────
      const projectName = `E2E Flow3 ${runTag}`;
      await test.step("create project", async () => {
        await page.goto("/projects");
        await page.getByPlaceholder("Mainboard rev C").fill(projectName);
        await page.getByPlaceholder("Acme Robotics").fill("Flow3 Fixture Client");
        await page.getByRole("button", { name: "Create" }).click();
        await page.waitForURL(/\/projects\/[0-9a-f-]+$/, { timeout: 15_000 });
      });

      const projectId = new URL(page.url()).pathname.split("/")[2]!;

      // ── 2. Create BOM in-app with a custom column ───────────────────────
      const bomName = `Flow3 BOM ${runTag}`;
      const customFieldLabel = `Flow3 Note ${runTag}`;
      await test.step("create BOM in-app with a custom column, build_qty ×1", async () => {
        await page.goto(`/projects/${projectId}/boms/new`);
        await page.getByRole("radio", { name: "Create in-app" }).click();

        // "+ Add field" → a custom text column, remembered as part of the
        // company template (R2-19) — proves the custom-column path, not just
        // the 11 standard ones.
        await page.getByRole("button", { name: "+ Add field" }).click();
        await page.getByPlaceholder("Field name").fill(customFieldLabel);
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await expect(page.getByText(customFieldLabel)).toBeVisible();

        // Down to exactly one row (the grid starts with two blanks).
        await page.getByRole("button", { name: "Remove row 2" }).click();

        const row = page.locator("tbody tr").first();
        const cells = row.locator("input");
        await cells.nth(0).fill("R1"); // references
        await cells.nth(1).fill("1"); // qty
        await cells.nth(2).fill("10uF"); // value
        await cells.nth(3).fill("0603"); // footprint
        await cells.nth(6).fill(lowStockPart.mpn); // mpn — the standard 11 columns are always first, in fixed order
        await cells.last().fill("flow3-demo"); // the just-added custom column, always appended last

        await page.getByPlaceholder("Mainboard v1.2").fill(bomName);
        // Leave "Build qty ×N" at its default 1 here — bumped explicitly below
        // so the reconcile flip (in_stock → to_order) is an observed state
        // change, not baked into the initial save.

        await page.getByRole("button", { name: "Save & reconcile" }).click();
        await page.waitForURL(new RegExp(`/projects/${projectId}/boms/[0-9a-f-]+$`), { timeout: 20_000 });
        await expect(page.getByText(bomName)).toBeVisible();
      });

      const bomId = new URL(page.url()).pathname.split("/").pop()!;

      async function readStat(label: string): Promise<number> {
        const card = page.locator(".rounded-2xl", { hasText: label }).first();
        const text = await card.locator("div").first().innerText();
        return Number(text.replace(/,/g, ""));
      }

      await test.step("reconcile at build_qty ×1 shows the line in stock", async () => {
        expect(await readStat("Lines")).toBe(1);
        expect(await readStat("In stock")).toBe(1);
        expect(await readStat("To order")).toBe(0);
      });

      // ── 3. Bump build_qty ×10 → re-reconcile flips the line to to-order ──
      await test.step("set build_qty ×10 → reconcile flips the ×1-in-stock line to to-order", async () => {
        const buildQtyCard = page.locator(".rounded-2xl", { hasText: "Build qty ×N" }).first();
        await buildQtyCard.locator("input").fill("10");
        await buildQtyCard.getByRole("button", { name: "Save" }).click();

        await expect(async () => {
          expect(await readStat("In stock")).toBe(0);
          expect(await readStat("To order")).toBe(1);
        }).toPass({ timeout: 15_000 });
      });

      // lowStockPart's OWN BOM line is now its ONLY source of demand in
      // `v_part_demand` (need 10 > the 8 on hand) — left as-is, that makes
      // this exact part/line ALSO surface as a cross-project `auto_shortfall`
      // suggestion the moment /cart is ever touched (even by Next.js's
      // background `<Link href="/cart">` prefetch on the review page's own
      // footer, well before this flow ever clicks "Add to cart"). Because
      // `smark_cart_items` allows at most ONE active row per part_id
      // (`idx_smark_cart_items_one_active_per_part`) and the review-add path
      // recognizes "same part_id, same bom_line_id" as the identical demand
      // slice already covered, whichever write lands first (prefetch's
      // auto_shortfall insert vs. this flow's own review-add) wins that row's
      // identity — a real race this test doesn't want to depend on. Topping
      // the part up now — AFTER the flip above is already asserted, so the
      // BOM line's STORED `match_state` stays `to_order` (reconcile is
      // recompute-on-demand, not live) — drops the LIVE shortfall to zero
      // before this part's cart line is ever touched, so "add to cart from
      // review" always creates a clean, uncontested `review_add` row.
      const TOP_UP_QTY = 12;
      await test.step("top up lowStockPart so it no longer competes with its own auto-shortfall suggestion", async () => {
        const { error } = await service
          .from("smark_stock_locations")
          .insert({ part_id: lowStockPart.id, big_box_id: boxId, qty: TOP_UP_QTY });
        if (error) throw new Error(`could not top up lowStockPart: ${error.message}`);
      });

      // ── 4. Point this BOM's distributor sequence at ONLY LCSC (mock-safe) ─
      await test.step("pin distributor sequence to LCSC only (mock-safe sourcing)", async () => {
        const sequence = distributors.map((d) => ({ distributor_id: d.id as string, enabled: (d.name as string) === "LCSC" }));
        if (!sequence.some((s) => s.enabled)) throw new Error('"LCSC" isn\'t seeded (supabase/seed.sql).');
        const { error } = await service.from("smark_boms").update({ distributor_sequence: sequence }).eq("id", bomId);
        if (error) throw new Error(`could not pin distributor sequence: ${error.message}`);
      });

      // ── 5. Run ordering — mock agents stream to the console ─────────────
      await test.step("run ordering (mock agents) → wait for done", async () => {
        await page.goto(`/projects/${projectId}/ordering/${bomId}`);
        await expect(page.getByRole("heading", { name: bomName })).toBeVisible();

        const runOrderingButton = page.getByRole("button", { name: /run ordering/i });
        await expect(runOrderingButton).toBeEnabled();
        await runOrderingButton.click();

        await page.waitForURL(new RegExp(`/projects/${projectId}/runs/[0-9a-f-]+$`), { timeout: 30_000 });
        await expect(page.getByText("Master agent")).toBeVisible();

        drainAgentRuns();

        await page.reload();
        const reviewButton = page.getByRole("button", { name: /review results/i });
        await expect(reviewButton).toBeVisible({ timeout: 15_000 });
        await reviewButton.click();
        // 60s (not this step's other 30s waits): this is the FIRST navigation
        // to /projects/:id/runs/:id/review of this whole run — a route this
        // spec's own suite-mates (ordering-run-review.spec.ts, bom-upload.spec.ts)
        // may or may not have already warmed by the time this test reaches
        // it, depending on how Playwright happens to interleave spec files
        // this run. A verified failure (30s timeout right here, review page
        // never navigated to) traced back to exactly this: whichever spec
        // hits /review FIRST across the whole suite pays this route's
        // Turbopack cold-compile cost on top of the click itself, under the
        // same shared-`next dev`-process contention playwright.config.ts's
        // own header documents.
        await page.waitForURL(new RegExp(`/projects/${projectId}/runs/[0-9a-f-]+/review$`), { timeout: 60_000 });
      });

      // ── 6. Review persists after a reload (R2-08) ───────────────────────
      // Generous (15s, not this suite's 5s default) timeouts from here on:
      // several assertions below depend on a Server Action's `revalidatePath`
      // + the invoking client's automatic RSC re-render, not a fresh page
      // load — normally quick, but this suite's own webServer is a SINGLE
      // shared `next dev` process (playwright.config.ts's own header explains
      // the cold-compile contention risk at >2 workers), and in practice this
      // repo's e2e suite runs alongside OTHER spec files/agents against that
      // same shared server + Supabase stack, which can push an ordinarily
      // sub-second round trip past 5s under load without anything actually
      // being broken.
      const lineCard = page.locator(".rounded-2xl", { hasText: "R1" }).first();
      await test.step("review persists after page reload", async () => {
        await expect(lineCard).toBeVisible();
        await expect(lineCard.getByText("Recommended", { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(lineCard.getByText("Confidence")).toBeVisible();

        await page.reload();

        // Same stored state, not a client-only draft — the same line card,
        // still showing its persisted (not re-computed) recommendation.
        await expect(lineCard).toBeVisible();
        await expect(lineCard.getByText("Recommended", { exact: true })).toBeVisible({ timeout: 15_000 });
      });

      // ── 7. Add to cart ───────────────────────────────────────────────────
      await test.step("add to cart from review", async () => {
        await lineCard.getByRole("button", { name: /add to cart/i }).click();
        await expect(lineCard.getByText(/added to cart|already in cart/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/added to cart: \d+ item/i)).toBeVisible({ timeout: 15_000 });
      });

      // ── 8. Cart: the canonical shortfall example + the review-added line ─
      // /cart is a server render of a moment ago's DB state, and the writes
      // asserted below (review add + shortfall recompute) land via Server
      // Actions on OTHER pages. Under this suite's 2-worker contention a
      // single goto can render before those commits are visible to it, and
      // `toBeVisible` only re-polls the DOM — it never re-renders the page.
      // So each card assertion reload-polls: a genuinely missing line still
      // fails (reloads can't conjure a row), only the render-race is immune.
      const gotoCartUntilVisible = async (card: ReturnType<typeof page.locator>) => {
        await expect(async () => {
          await page.goto("/cart");
          await expect(card).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 45_000 });
      };

      const shortfallCard = page.locator(".rounded-2xl", { hasText: shortfallPart.internalPid }).first();
      await test.step("cart shows the canonical shortfall auto-line (500 avail / 400+200 → exactly 100)", async () => {
        await gotoCartUntilVisible(shortfallCard);
        await expect(shortfallCard.getByText("Auto · shortfall")).toBeVisible();
        await expect(shortfallCard.locator("input").first()).toHaveValue("100");
      });

      const cartCard = page.locator(".rounded-2xl", { hasText: lowStockPart.internalPid }).first();
      await test.step("cart shows the review-added line", async () => {
        await gotoCartUntilVisible(cartCard);
        await expect(cartCard.getByText("From review")).toBeVisible();
      });

      // ── 9. Checkout: blocked without a PO, grouped by distributor ───────
      const poNumber = `E2E-FLOW3-${runTag}`;
      await test.step("select distributor, checkout blocked without a PO number", async () => {
        await cartCard.locator("select").selectOption({ label: "LCSC" });

        const checkbox = cartCard.getByRole("checkbox");
        await expect(checkbox).toBeEnabled({ timeout: 15_000 });
        await checkbox.check();

        await page.getByRole("button", { name: /^Checkout \(1\)$/ }).click();
        const dialog = page.getByRole("dialog", { name: "Checkout" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("LCSC")).toBeVisible();

        await dialog.getByRole("button", { name: /confirm order/i }).click();
        await expect(page.getByText("Enter at least one order number to place.")).toBeVisible({ timeout: 15_000 });
        // Blocked — the drawer stays open, nothing was placed yet.
        await expect(dialog).toBeVisible();

        await dialog.getByPlaceholder("e.g. SO-48213").fill(poNumber);
        await dialog.getByRole("button", { name: /confirm order/i }).click();
        await expect(page.getByText(new RegExp(`LCSC placed .* PO ${poNumber}`))).toBeVisible({ timeout: 15_000 });
      });

      // ── 10. Draft expense spawned by the placed order (Q-09) ────────────
      const cartItemRow = await test.step("checkout spawned a draft expense", async () => {
        const cartItem = await service
          .from("smark_cart_items")
          .select("*")
          .eq("part_id", lowStockPart.id)
          .eq("source", "review_add")
          .single();
        if (cartItem.error || !cartItem.data) throw new Error(`could not find the placed cart item: ${cartItem.error?.message}`);
        expect(cartItem.data.status).toBe("ordered");

        const expense = await service
          .from("smark_expenses")
          .select("*")
          .eq("note", `PO ${poNumber}`)
          .maybeSingle();
        if (expense.error) throw new Error(`could not look up the draft expense: ${expense.error.message}`);
        expect(expense.data, "a draft expense row exists for this PO").toBeTruthy();
        expect(expense.data!.is_draft).toBe(true);
        expect(expense.data!.amount).toBeGreaterThan(0);

        return cartItem.data;
      });

      // ── 11. Mark arrived, then put away via Receive ─────────────────────
      await test.step("mark the order line arrived", async () => {
        await page.reload();
        await page.getByRole("radio", { name: /^Ordered \(\d+\)$/ }).click();
        const orderGroup = page.locator(".rounded-2xl", { hasText: `PO ${poNumber}` }).first();
        await expect(orderGroup).toBeVisible({ timeout: 15_000 });
        await expect(orderGroup.getByText("LCSC")).toBeVisible();
        await orderGroup.getByRole("button", { name: /mark arrived/i }).click();
        await expect(orderGroup.getByRole("button", { name: /mark arrived/i })).toBeHidden({ timeout: 15_000 });
      });

      await test.step("put away via Receive stamps last_unit_price", async () => {
        await page.goto("/receive?card=put-away");
        const arrivedLine = page.getByRole("button").filter({ hasText: lowStockPart.internalPid });
        await expect(arrivedLine).toBeVisible({ timeout: 15_000 });
        await arrivedLine.click();
        await page.getByRole("button", { name: /confirm.*put away/i }).click();
        await expect(page.getByText(new RegExp(`Put away 10 . ${lowStockPart.internalPid}`))).toBeVisible({ timeout: 15_000 });
      });

      // ── 12. last_unit_price stamped — verified at the data layer AND via the part drawer ──
      const priceRow = await service
        .from("smark_cart_items")
        .select("unit_price")
        .eq("id", cartItemRow.id)
        .single();
      if (priceRow.error || priceRow.data?.unit_price == null) {
        throw new Error(`expected the cart item to carry the sourced unit price: ${priceRow.error?.message}`);
      }
      const price = priceRow.data.unit_price as number;

      await test.step("part.last_unit_price stamped (part drawer)", async () => {
        const partAfter = await service
          .from("smark_parts")
          .select("total_qty, last_unit_price")
          .eq("id", lowStockPart.id)
          .single();
        if (partAfter.error || !partAfter.data) throw new Error(`could not re-read the part: ${partAfter.error?.message}`);
        expect(partAfter.data.last_unit_price).toBeCloseTo(price, 5);
        const expectedTotalQty = 8 + TOP_UP_QTY + 10; // seeded + topped up (above) + put away
        expect(partAfter.data.total_qty).toBe(expectedTotalQty);

        // Faithfully exercises the SAME pure function the Dashboard tile
        // uses (lib/dashboard/compute.ts) for this one part's own
        // contribution — a global, DB-wide "inventory value" number isn't
        // safely assertable exactly (this suite runs the SAME spec
        // concurrently on desktop-1280 + mobile-360 against one shared
        // Supabase stack, and other suites price/move stock too), but this
        // part's own delta is fully deterministic.
        const contribution = computeInventoryValue([partAfter.data]);
        expect(contribution.unpricedCount).toBe(0);
        expect(contribution.value).toBeCloseTo(expectedTotalQty * price, 5);

        await page.goto(`/part/${lowStockPart.internalPid}`);
        await expect(page.getByText("Last price")).toBeVisible();
        await expect(page.getByText(formatINR(price))).toBeVisible();
      });

      // ── 13. Dashboard renders the inventory-value tile (this part now flows into it) ──
      await test.step("dashboard inventory value reflects it", async () => {
        await page.goto("/dashboard");
        await expect(page.getByText(/Inventory value/i)).toBeVisible();
      });
    });
  });
}
