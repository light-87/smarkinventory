#!/usr/bin/env bun
/**
 * scripts/import-clockify.ts — one-shot import of the two legacy Clockify
 * "Time Report Detailed" CSV exports into the EXISTING `smark_time_entries`
 * table (0001) — NOT the new task-based `smark_time_logs` (0010). Legacy
 * projects have no task estimates → no KPI, by design (supabase/migrations/
 * 0010_pm.sql header / lib/pm/kpi.ts).
 *
 * Usage:
 *   bun run scripts/import-clockify.ts [--dry-run] [--verbose]
 *
 * Reads (repo root, checked-in client exports):
 *   Clockify_Time_Report_Detailed_01-01-2025-31-12-2025.csv
 *   Clockify_Time_Report_Detailed_01-01-2026-31-12-2026.csv
 *
 * Column notes (both files share the same header):
 *   - Dates ("Start Date"/"End Date") are DD-MM-YYYY.
 *   - "Duration (decimal)" is hours (what smark_time_entries.hours wants).
 *   - The real work text is "Description" — "Task" is EMPTY in every row of
 *     the client's export, so it is ignored.
 *
 * What it does:
 *   1. Parse both CSVs (hand-rolled RFC4180-ish reader — every field in this
 *      export is double-quoted, matching lib/expenses/csv.ts's own note that
 *      this repo has no CSV parsing library dependency).
 *   2. One row per distinct "Project" → find-or-create a `smark_projects`
 *      row: reuses an EXISTING project with the exact same name (case-
 *      insensitive) if one exists (idempotent reruns AND lets this coexist
 *      with a project already created some other way); otherwise creates a
 *      new one with `imported_at` stamped and `client` from the CSV's Client
 *      column. Existing-but-not-yet-imported projects get `imported_at`
 *      backfilled (does not touch anything else on that row).
 *   3. User mapping: match each row's Clockify `User`/`Email` against
 *      EXISTING `smark_app_users` (by username, then by the local part of a
 *      synthetic email, then by a normalized display_name). Known identity
 *      merge (explicit prompt instruction): `sourabh.satpaise1994@gmail.com`
 *      is the SAME person as `sourabh.smark@gmail.com` — canonicalized BEFORE
 *      matching. Unmatched users get an INACTIVE placeholder `smark_app_users`
 *      row created via the repo's username → synthetic-email scheme
 *      (`lib/auth/roles.ts` usernameToEmail) and are logged.
 *   4. Writes one `smark_time_entries` row per CSV row: project_id, user_id,
 *      work_date (Start Date, converted), hours (Duration decimal),
 *      note (Description), entered_by = the same user (self-logged history).
 *
 * `--dry-run` parses + matches and prints the summary a real run would
 * produce (project/user/entry counts + every unmatched user), without
 * writing anything. `--verbose` also prints a few sample rows.
 *
 * SERVICE-ROLE KEY, SCRIPT-ONLY — same rationale as scripts/import-stocklist.ts:
 * a trusted operator tool run from a terminal, never from an app route.
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServiceClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/auth/roles";
import { TABLES } from "@/types/db";

const CSV_FILES = [
  "Clockify_Time_Report_Detailed_01-01-2025-31-12-2025.csv",
  "Clockify_Time_Report_Detailed_01-01-2026-31-12-2026.csv",
];

/** Clockify emails known to be the SAME real person — canonicalize to the first before matching/creating anyone. */
const EMAIL_MERGE_MAP: Record<string, string> = {
  "sourabh.satpaise1994@gmail.com": "sourabh.smark@gmail.com",
};

interface ClockifyRow {
  project: string;
  client: string;
  description: string;
  user: string;
  email: string;
  startDate: string; // DD-MM-YYYY
  durationDecimal: string;
}

interface ParsedEntry {
  project: string;
  client: string;
  note: string;
  user: string;
  email: string;
  /** YYYY-MM-DD */
  workDate: string;
  hours: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * CSV parsing — every field in this export is double-quoted (RFC4180: "" is
 * an escaped quote inside a quoted field); no library dependency (CLAUDE.md /
 * lib/expenses/csv.ts precedent).
 * ──────────────────────────────────────────────────────────────────────────── */

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(raw: string): ClockifyRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]!);
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Clockify CSV missing expected column "${name}"`);
    return i;
  };

  const projectIdx = idx("Project");
  const clientIdx = idx("Client");
  const descriptionIdx = idx("Description");
  const userIdx = idx("User");
  const emailIdx = idx("Email");
  const startDateIdx = idx("Start Date");
  const durationDecimalIdx = idx("Duration (decimal)");

  const rows: ClockifyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    if (fields.every((f) => f.trim() === "")) continue;
    rows.push({
      project: (fields[projectIdx] ?? "").trim(),
      client: (fields[clientIdx] ?? "").trim(),
      description: (fields[descriptionIdx] ?? "").trim(),
      user: (fields[userIdx] ?? "").trim(),
      email: (fields[emailIdx] ?? "").trim().toLowerCase(),
      startDate: (fields[startDateIdx] ?? "").trim(),
      durationDecimal: (fields[durationDecimalIdx] ?? "0").trim(),
    });
  }
  return rows;
}

/** "31-12-2025" → "2025-12-31". */
function ddmmyyyyToIso(dateStr: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateStr);
  if (!m) throw new Error(`Unexpected date format: "${dateStr}" (expected DD-MM-YYYY)`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function canonicalEmail(email: string): string {
  const lower = email.toLowerCase();
  return EMAIL_MERGE_MAP[lower] ?? lower;
}

/** Best-effort local-part → username slug, mirroring lib/auth/roles.ts's synthetic-email convention loosely (lowercase, dot/alnum only). */
function emailLocalPartToUsername(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Args
 * ──────────────────────────────────────────────────────────────────────────── */

function parseArgs(argv: string[]): { dryRun: boolean; verbose: boolean } {
  return { dryRun: argv.includes("--dry-run"), verbose: argv.includes("--verbose") };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Main
 * ──────────────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const { dryRun, verbose } = parseArgs(process.argv.slice(2));

  const allRows: ParsedEntry[] = [];
  for (const filename of CSV_FILES) {
    const filePath = resolve(process.cwd(), filename);
    if (!existsSync(filePath)) {
      console.error(`✗ File not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const raw = readFileSync(filePath, "utf8");
    const rows = parseCsv(raw);
    for (const r of rows) {
      if (!r.project || !r.startDate) continue;
      const hours = Number(r.durationDecimal);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      allRows.push({
        project: r.project,
        client: r.client,
        note: r.description,
        user: r.user,
        email: canonicalEmail(r.email),
        workDate: ddmmyyyyToIso(r.startDate),
        hours,
      });
    }
    console.log(`Parsed ${rows.length} rows from ${filename}`);
  }

  // ---- Distinct projects (first non-empty Client wins for that project) ----
  const projectClient = new Map<string, string | null>();
  for (const r of allRows) {
    if (!projectClient.has(r.project)) projectClient.set(r.project, r.client || null);
  }

  // ---- Distinct users (by canonical email; fall back to the raw `User` login string) ----
  const userIdentity = new Map<string, { user: string; email: string }>();
  for (const r of allRows) {
    const key = r.email || r.user.toLowerCase();
    if (!userIdentity.has(key)) userIdentity.set(key, { user: r.user, email: r.email });
  }

  console.log(`\nDistinct projects: ${projectClient.size}`);
  console.log(`Distinct users: ${userIdentity.size}`);
  console.log(`Total entries to import: ${allRows.length}`);

  const service = dryRun ? null : createServiceClient();

  // ---- Match/create app users ----
  const existingUsersRes = service
    ? await service.from(TABLES.app_users).select("id, username, display_name")
    : { data: [] as Array<{ id: string; username: string; display_name: string | null }> };
  const existingUsers = (existingUsersRes.data ?? []) as Array<{ id: string; username: string; display_name: string | null }>;

  function findExistingUser(user: string, email: string): { id: string; username: string } | null {
    const localPart = emailLocalPartToUsername(email || user);
    const byUsername = existingUsers.find((u) => u.username.toLowerCase() === localPart || u.username.toLowerCase() === user.toLowerCase());
    if (byUsername) return { id: byUsername.id, username: byUsername.username };

    const normalizedUser = user.toLowerCase().replace(/[._-]/g, " ").trim();
    const byDisplayName = existingUsers.find((u) => {
      if (!u.display_name) return false;
      const normalizedDisplay = u.display_name.toLowerCase().replace(/\([^)]*\)/g, "").trim();
      return normalizedDisplay === normalizedUser || normalizedDisplay.includes(normalizedUser) || normalizedUser.includes(normalizedDisplay);
    });
    return byDisplayName ? { id: byDisplayName.id, username: byDisplayName.username } : null;
  }

  const userIdByKey = new Map<string, string>();
  const unmatchedUsers: Array<{ user: string; email: string; placeholderUsername: string }> = [];

  for (const [key, identity] of userIdentity) {
    const existing = findExistingUser(identity.user, identity.email);
    if (existing) {
      userIdByKey.set(key, existing.id);
      continue;
    }

    const placeholderUsername = emailLocalPartToUsername(identity.email || identity.user);
    unmatchedUsers.push({ user: identity.user, email: identity.email, placeholderUsername });

    if (dryRun) continue;

    const svc = service!;
    const placeholderEmail = usernameToEmail(placeholderUsername);
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email: placeholderEmail,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      console.error(`✗ Could not create placeholder auth user for "${identity.user}" (${placeholderEmail}): ${createErr?.message}`);
      continue;
    }
    const { error: profileErr } = await svc.from(TABLES.app_users).insert({
      id: created.user.id,
      username: placeholderUsername,
      display_name: identity.user,
      role: "employee",
      active: false,
    });
    if (profileErr) {
      console.error(`✗ Could not create placeholder profile for "${identity.user}": ${profileErr.message}`);
      continue;
    }
    userIdByKey.set(key, created.user.id);
  }

  console.log(`\nMatched to existing users: ${userIdentity.size - unmatchedUsers.length}`);
  console.log(`Unmatched (${dryRun ? "would create" : "created"} INACTIVE placeholders): ${unmatchedUsers.length}`);
  for (const u of unmatchedUsers) {
    console.log(`  - "${u.user}" <${u.email || "no email"}> → placeholder username "${u.placeholderUsername}"`);
  }

  if (dryRun) {
    if (verbose) {
      console.log("\nSample entries:");
      for (const r of allRows.slice(0, 5)) {
        console.log(`  ${r.workDate}  ${r.hours}h  [${r.project}]  ${r.user}: ${r.note.slice(0, 60)}`);
      }
    }
    console.log("\n--dry-run: no rows written.");
    return;
  }

  const svc = service!;

  // ---- Find-or-create projects ----
  const { data: existingProjects } = await svc.from(TABLES.projects).select("id, name, imported_at");
  const projectByName = new Map<string, { id: string; imported_at: string | null }>(
    ((existingProjects ?? []) as Array<{ id: string; name: string; imported_at: string | null }>).map((p) => [
      p.name.toLowerCase(),
      { id: p.id, imported_at: p.imported_at },
    ]),
  );

  const projectIdByName = new Map<string, string>();
  let projectsCreated = 0;
  let projectsBackfilled = 0;

  for (const [name, client] of projectClient) {
    const existing = projectByName.get(name.toLowerCase());
    if (existing) {
      projectIdByName.set(name, existing.id);
      if (existing.imported_at === null) {
        const { error } = await svc.from(TABLES.projects).update({ imported_at: new Date().toISOString() }).eq("id", existing.id);
        if (!error) projectsBackfilled++;
      }
      continue;
    }

    const { data: created, error } = await svc
      .from(TABLES.projects)
      .insert({ name, client, imported_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !created) {
      console.error(`✗ Could not create project "${name}": ${error?.message}`);
      continue;
    }
    projectIdByName.set(name, created.id as string);
    projectsCreated++;
  }

  console.log(`\nProjects created: ${projectsCreated}, backfilled imported_at: ${projectsBackfilled}, reused as-is: ${projectClient.size - projectsCreated - projectsBackfilled}`);

  // ---- Write smark_time_entries ----
  const INSERT_CHUNK_SIZE = 500;
  let inserted = 0;
  let skipped = 0;
  const chunk: Array<{ project_id: string; user_id: string; work_date: string; hours: number; note: string | null; entered_by: string }> = [];

  async function flush(): Promise<void> {
    if (chunk.length === 0) return;
    const { error } = await svc.from(TABLES.time_entries).insert(chunk.splice(0, chunk.length));
    if (error) {
      console.error(`✗ Batch insert failed: ${error.message}`);
      skipped += chunk.length;
    } else {
      inserted += chunk.length;
    }
  }

  for (const r of allRows) {
    const projectId = projectIdByName.get(r.project);
    const key = r.email || r.user.toLowerCase();
    const userId = userIdByKey.get(key);
    if (!projectId || !userId) {
      skipped++;
      continue;
    }
    chunk.push({
      project_id: projectId,
      user_id: userId,
      work_date: r.workDate,
      hours: Math.min(r.hours, 24), // smark_time_entries.hours check (0 < hours <= 24)
      note: r.note || null,
      entered_by: userId,
    });
    if (chunk.length >= INSERT_CHUNK_SIZE) await flush();
  }
  await flush();

  console.log(`\nInserted ${inserted} smark_time_entries rows (${skipped} skipped).`);
  console.log("Done.");
}

await main();
