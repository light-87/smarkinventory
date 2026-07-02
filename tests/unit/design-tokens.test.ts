import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Locked design-system regression guard (DESIGN.md / tokens.json / theme.css).
 * The dark theme and the SMARK orange are contractual — if someone edits
 * app/globals.css and drops or changes these tokens, this fails the build.
 * tests/e2e/smoke.spec.ts asserts the same obsidian background at runtime.
 */
const globalsCss = readFileSync(
  join(import.meta.dir, "../../app/globals.css"),
  "utf8",
);

describe("locked design tokens (app/globals.css)", () => {
  test.each([
    ["SMARK brand orange", "--color-smark-orange: #f57d05"],
    ["obsidian canvas", "--color-obsidian: #121212"],
    ["ash card surface", "--color-ash: #242424"],
    ["snow foreground", "--color-snow: #fafafa"],
  ])("%s stays locked (%s)", (_name, declaration) => {
    expect(globalsCss).toContain(declaration);
  });

  test("app is dark-mode native (color-scheme: dark)", () => {
    expect(globalsCss).toContain("color-scheme: dark");
  });
});
