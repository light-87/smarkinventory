/**
 * worker/src/types/playwright-shim.d.ts — ambient module declaration so
 * `PlaywrightDriver` (worker/src/browser-driver.ts) type-checks WITHOUT the
 * `playwright` package installed anywhere in this repo.
 *
 * `PlaywrightDriver.searchPart` is "code-complete but NEVER invoked in
 * tests/CI" (build brief) — its dynamic `import("playwright")` only
 * resolves at runtime if a human deliberately installs `playwright`
 * (`bun add playwright` inside `worker/`, NOT done by this package/deploy
 * by default) and sets `BROWSER_DRIVER=playwright` + `ALLOW_LIVE_BROWSER=1`.
 * Until then this shim keeps `bunx tsc --noEmit` (run from the repo root,
 * which globs every .ts file under worker/ too — see root tsconfig.json) green.
 *
 * Deliberately untyped (`any`) — the real types come from the `playwright`
 * package itself once it's actually installed for a live run; this file's
 * only job is "don't 404 on `import`", not "describe the API".
 */
declare module "playwright";
