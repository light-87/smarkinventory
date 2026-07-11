import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Design-system regression guard (new_design/ "Buddy" white theme).
 * The white canvas + cobalt/lime accent are contractual — if someone edits
 * app/globals.css and drops or changes these tokens, this fails the build.
 * tests/e2e/smoke.spec.ts asserts the same white background at runtime.
 */
const globalsCss = readFileSync(
  join(import.meta.dir, "../../app/globals.css"),
  "utf8",
);

describe("design tokens (app/globals.css)", () => {
  test.each([
    ["cobalt accent (legacy orange name)", "--color-smark-orange: #1a67fd"],
    ["lime CTA", "--color-lime: #bfff5a"],
    ["obsidian ink", "--color-obsidian: #0a0d16"],
    ["canvas page background", "--color-canvas: #fcfcfd"],
    ["snow primary ink", "--color-snow: #1d2130"],
  ])("%s stays locked (%s)", (_name, declaration) => {
    expect(globalsCss).toContain(declaration);
  });

  test("app is light-mode native (color-scheme: light)", () => {
    expect(globalsCss).toContain("color-scheme: light");
  });
});
