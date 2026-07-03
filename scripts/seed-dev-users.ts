/**
 * scripts/seed-dev-users.ts — creates the three role accounts (owner,
 * employee, accountant) against the LOCAL Supabase stack, for manual login
 * testing and as the eventual basis for tests/integration/rls-matrix.test.ts
 * (docs/OWNERSHIP.md: "this package seeds the role users").
 *
 * Usage:
 *   bun run scripts/seed-dev-users.ts
 *
 * Requires `bunx supabase start` running and .env.local pointing at it
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Safe to re-run —
 * upserts the smark_app_users profile row and skips auth.users creation if
 * the email already exists.
 *
 * NOT for production. The owner creates real users via Settings → Users
 * (a later surface) using the same auth.admin.createUser + smark_app_users
 * insert shape as below.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/db";
import { TABLES } from "../types/db";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run `bunx supabase start`, copy its output into .env.local (see docs/DEV.md §2), then retry.",
  );
  process.exit(1);
}

const admin = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface SeedUser {
  username: string;
  password: string;
  displayName: string;
  role: "owner" | "employee" | "accountant";
}

const SEED_USERS: SeedUser[] = [
  { username: "owner", password: "Owner@12345", displayName: "Suresh (Owner)", role: "owner" },
  { username: "employee", password: "Employee@12345", displayName: "Priya (Employee)", role: "employee" },
  { username: "accountant", password: "Accountant@12345", displayName: "Anita (Accountant)", role: "accountant" },
];

async function seedUser(u: SeedUser): Promise<void> {
  const email = `${u.username}@smark.internal`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: u.password,
    email_confirm: true,
  });

  let userId = created?.user?.id;

  if (createError) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers();
    const existing = list?.users.find((x) => x.email === email);
    if (!existing) {
      console.error(`✗ ${u.username}: create failed (${createError.message}) and no existing user found`, listError ?? "");
      return;
    }
    // Re-run idempotency: force the password back to this script's known
    // value rather than silently keeping whatever it was set to last time
    // (otherwise "safe to re-run" is a lie — login would fail with a
    // password nobody remembers).
    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password: u.password,
      email_confirm: true,
    });
    if (updateError) {
      console.error(`✗ ${u.username}: password reset failed — ${updateError.message}`);
      return;
    }
    userId = existing.id;
  }

  if (!userId) {
    console.error(`✗ ${u.username}: no user id after create/lookup`);
    return;
  }

  const { error: profileError } = await admin
    .from(TABLES.app_users)
    .upsert(
      { id: userId, username: u.username, display_name: u.displayName, role: u.role, active: true },
      { onConflict: "id" },
    );

  if (profileError) {
    console.error(`✗ ${u.username}: profile upsert failed — ${profileError.message}`);
    return;
  }

  console.log(`✓ ${u.role.padEnd(11)} ${u.username} / ${u.password}`);
}

for (const u of SEED_USERS) {
  await seedUser(u);
}

console.log("\nDone — sign in at /login with any username/password above.");
