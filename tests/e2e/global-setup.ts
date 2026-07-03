import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Playwright globalSetup — re-seeds the three dev-role auth users
 * (owner/employee/accountant) before any spec runs.
 *
 * Why: `bunx supabase db reset` wipes `auth.users`, but every login-gated
 * spec signs in as the seeded `owner` user. Without this hook the suite
 * only passes if someone remembered to run `scripts/seed-dev-users.ts`
 * after the last reset (WF-1 verify rounds went red on exactly that).
 * The seed script is idempotent (creates-or-resets passwords), so running
 * it on every e2e invocation is safe and costs ~2s. CI seeds explicitly
 * too (.github/workflows/ci.yml playwright job) — this double-seed is a
 * no-op there.
 *
 * Runs via `bun run` so Bun auto-loads .env.local (NODE_ENV is not "test"
 * here, unlike under `bun test`). If local Supabase isn't running the
 * script exits 1 and the whole e2e run fails loud with its message —
 * consistent with the repo's fail-loud-not-skip-silently rule.
 *
 * Uses `__dirname` (not `import.meta.url`/`fileURLToPath`) deliberately:
 * package.json has no top-level `"type": "module"`, so Playwright's runtime
 * loads this file as CommonJS. A file containing `import.meta` can't be
 * safely emitted as CJS (there's no CJS equivalent), which produced a
 * CJS/ESM mismatch — `ReferenceError: exports is not defined` at runtime,
 * before any spec ran. `__dirname` is a plain CommonJS global here, so the
 * whole file compiles and runs as CJS with no special-casing needed.
 */
export default function globalSetup(): void {
  const repoRoot = path.resolve(__dirname, "..", "..");
  // `shell: true`: on Windows, global installs of `bun` resolve to `bun.cmd`
  // (a shim), and Node's execFileSync cannot exec `.cmd` files directly
  // without a shell — it fails with `ENOENT` even though `bun` is on PATH
  // and `bunx playwright test` itself launched fine. Routing through the
  // shell (cmd.exe on Windows, /bin/sh elsewhere) matches how `npm`-shimmed
  // CLIs are conventionally spawned from Node and is safe here since the
  // args are static, non-attacker-controlled strings.
  execFileSync("bun", ["run", "scripts/seed-dev-users.ts"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
}
