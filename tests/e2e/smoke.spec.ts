import { expect, test } from "@playwright/test";

/**
 * E2E smoke test — the one spec that must never go red (plan/TESTING.md §2
 * "E2E" layer + R2-29 CI gate). Runs on both playwright.config.ts projects
 * (desktop-1280 + mobile-360) automatically. Asserts exactly two things:
 *   1. the app boots (dev server responds, shell renders past the title),
 *   2. the white theme renders (new_design/ — checked as computed style, so it
 *      fails if the actual rendered token ever drifts, not just the class name).
 *
 * Self-exclusion guard: `bunfig.toml` scopes `bun test` to the whole `tests/`
 * tree, and Bun's default test file matching also globs `*.spec.ts` — so a
 * bare `bun test` would otherwise try to load this file too. This file uses
 * `@playwright/test`'s `test()`, which throws ("Playwright Test did not
 * expect test() to be called here") when invoked outside `playwright test`'s
 * own runner. `process.versions.bun` is only set when the *Bun runtime* is
 * executing the file (`bun test`); `bunx playwright test` resolves to the
 * real Playwright CLI/Node process, where it's undefined — confirmed
 * empirically, not documented Bun/Playwright API, so keep this guard if
 * either toolchain changes that behaviour. Run E2E via `bunx playwright
 * test` (see docs/DEV.md), never via `bun test`.
 */
if (typeof process.versions.bun === "undefined") {
  test.describe("smoke", () => {
    test("app boots", async ({ page }) => {
      const response = await page.goto("/");
      expect(response?.ok(), "root route responds 2xx").toBeTruthy();
      await expect(page).toHaveTitle(/SmarkStock/i);
    });

    test("white theme renders", async ({ page }) => {
      await page.goto("/");

      // app/globals.css: body { background-color: var(--color-canvas) },
      // --color-canvas is #fcfcfd in the new_design white theme.
      const bodyBackground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(bodyBackground).toBe("rgb(252, 252, 253)");

      // app/globals.css: html { color-scheme: light } — native controls,
      // scrollbars etc. render light without extra per-component work.
      const colorScheme = await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      );
      expect(colorScheme).toBe("light");
    });
  });
}
