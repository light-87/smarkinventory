/**
 * lib/ai/alias.ts — the ALIAS LAYER (FEATURES.md §12, SCHEMA.md §7
 * `smark_ai_aliases`). Server-only. Every Claude call carrying business
 * context must pass through this before it leaves the process.
 *
 * `smark_ai_aliases` is RLS-locked to `service_role` only (migration 0004:
 * "server-side only, never sent to clients") and has no `real_name` column —
 * `entity_id uuid` is polymorphic, "no FK by design" (0004's own comment).
 * For `project`, that id can be the real `smark_projects.id`; for `client`
 * there IS no backing row (`client` is free text on `smark_projects.client`,
 * not its own table) and likewise for ad hoc `product`/`custom` labels. So
 * this module computes `entity_id` as a **deterministic UUID v5** over
 * `${kind}:${normalizedName}` (RFC 4122 §4.3, hand-rolled — no `uuid`
 * package is installed and adding one needs integrator sign-off per
 * CLAUDE.md "no bun add"). Same (kind, name) always yields the same id, so
 * `ensureAliases` is idempotent without needing a name column at all, and
 * the mapping is fully recoverable from a name the caller already has in
 * hand — which is exactly the shape every call site has (a project's
 * `.name`/`.client` fields), never a blind "alias everything in the DB"
 * scan.
 *
 * Split deliberately into a pure core (`computeAliasAssignments`,
 * `aliasText`, `deAliasText` — no I/O, unit-testable without a database)
 * and a thin I/O wrapper (`ensureAliases` — the only function that touches
 * Supabase). `buildPlannerContext` composes both: it is the ONE function
 * `bom-pipeline` should call to turn a project + BOM lines into something
 * safe to hand to Opus, and it is a WHITELIST (its input type structurally
 * has no `description`/`notes` field at all — see `PlannerProjectInput`
 * below), not a filter applied after the fact.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { AliasEntityTypeSchema, TABLES, type AliasEntityType } from "@/types/db";
import { createServiceClient } from "@/lib/supabase/server";

export type AliasKind = AliasEntityType; // "client" | "project" | "product" | "custom"

/* ────────────────────────────────────────────────────────────────────────────
 * Deterministic entity id (UUID v5, RFC 4122 §4.3)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Fixed, arbitrary namespace for SmarkStock's alias layer — stable across the app's lifetime; changing it would re-mint every alias. */
const ALIAS_NAMESPACE = "b7e6b9d0-3f0e-4c1a-9c9b-6f6f2b6a9d10";

function namespaceBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Same (kind, name) → same uuid, always. Case/whitespace-insensitive so "Power Breezer" and " power breezer " share one alias. */
export function deterministicEntityId(kind: AliasKind, name: string): string {
  const normalized = name.trim().toLowerCase();
  const hash = createHash("sha1")
    .update(namespaceBytes(ALIAS_NAMESPACE))
    .update(`${kind}:${normalized}`, "utf8")
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant RFC 4122
  return bytesToUuid(bytes);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Alias code formatting — CLIENT-A / PROJ-03 / PROD-03 / CUSTOM-03
 * ──────────────────────────────────────────────────────────────────────────── */

const PREFIX: Record<AliasKind, string> = {
  client: "CLIENT-",
  project: "PROJ-",
  product: "PROD-",
  custom: "CUSTOM-",
};

/** Clients get letters (matches the prototype's "CLIENT-A"); everything else gets zero-padded numbers ("PROJ-03"). */
const SUFFIX_STYLE: Record<AliasKind, "letter" | "number"> = {
  client: "letter",
  project: "number",
  product: "number",
  custom: "number",
};

/** 1 → "A", 26 → "Z", 27 → "AA" (spreadsheet-column style). */
function letterSuffix(n: number): string {
  let result = "";
  let value = n;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function letterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numberSuffix(n: number): string {
  return String(n).padStart(2, "0");
}

function formatAlias(kind: AliasKind, index: number): string {
  return PREFIX[kind] + (SUFFIX_STYLE[kind] === "letter" ? letterSuffix(index) : numberSuffix(index));
}

/** Inverse of `formatAlias` — returns null for an alias that doesn't belong to this kind or doesn't parse. */
function parseSuffixIndex(kind: AliasKind, alias: string): number | null {
  const prefix = PREFIX[kind];
  if (!alias.startsWith(prefix)) return null;
  const rest = alias.slice(prefix.length);
  if (SUFFIX_STYLE[kind] === "letter") {
    return /^[A-Z]+$/.test(rest) ? letterToIndex(rest) : null;
  }
  const n = Number.parseInt(rest, 10);
  return Number.isFinite(n) ? n : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pure core — no I/O, unit-testable (tests/unit/alias-*.test.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AliasRow {
  entity_id: string;
  alias: string;
}

export interface AliasAssignments {
  /** Real name (as given, trimmed) → alias code, for every requested name. */
  mapping: Map<string, string>;
  /** Rows this call needs to insert — empty when every name already had an alias. */
  newRows: AliasRow[];
}

/**
 * Given the FULL set of existing `smark_ai_aliases` rows for `kind` (not
 * filtered to the requested names — needed to find the next free suffix)
 * and the names this call wants aliased, returns the resulting name→alias
 * map plus any brand-new rows to persist. Pure: same inputs, same output,
 * no network — this is what `tests/unit/alias-assignment.test.ts` exercises
 * directly.
 */
export function computeAliasAssignments(kind: AliasKind, names: string[], existingRows: AliasRow[]): AliasAssignments {
  const byEntityId = new Map(existingRows.map((row) => [row.entity_id, row.alias] as const));

  let maxIndex = 0;
  for (const row of existingRows) {
    const idx = parseSuffixIndex(kind, row.alias);
    if (idx !== null && idx > maxIndex) maxIndex = idx;
  }

  const mapping = new Map<string, string>();
  const newRows: AliasRow[] = [];

  for (const rawName of names) {
    const name = rawName.trim();
    if (!name || mapping.has(rawName)) continue;

    const entityId = deterministicEntityId(kind, name);
    const existingAlias = byEntityId.get(entityId);
    if (existingAlias) {
      mapping.set(rawName, existingAlias);
      continue;
    }

    maxIndex += 1;
    const alias = formatAlias(kind, maxIndex);
    byEntityId.set(entityId, alias); // duplicate names within this same call reuse the freshly-minted code
    mapping.set(rawName, alias);
    newRows.push({ entity_id: entityId, alias });
  }

  return { mapping, newRows };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toEntries(mapping: Map<string, string> | Record<string, string>): Array<[string, string]> {
  return mapping instanceof Map ? Array.from(mapping.entries()) : Object.entries(mapping);
}

/**
 * A stored name's regex, tolerant of WHITESPACE variants only: internal
 * runs of whitespace in the stored name (single space, double space, a
 * tab/newline someone pasted) become a `\s+` match so "Power  Breezer"
 * (double space) or "Power\nBreezer" in free text still matches the
 * canonically-stored "Power Breezer". This does NOT catch abbreviations,
 * partial names, or misspellings — those are unbounded (see module doc);
 * callers passing user free text should still treat this as a best-effort
 * scrub, not a guarantee, for anything other than whitespace drift.
 *
 * Word-boundary matched (`\b`, same as `deAliasText`'s reverse pass) so a
 * name only matches as a whole token — without this, a project/client name
 * that happens to be a substring of a real, pass-through catalog identifier
 * (an MPN, a distributor name in rule text) would get rewritten too, e.g. a
 * client named "Digi" corrupting "Digikey" inside the injected rules digest.
 * §12's guarantee is that MPN/LCSC PN/package/distributor names pass through
 * REAL — this boundary is what keeps that true when a short entity name
 * collides with one (report finding #3).
 */
function buildNameRegex(name: string): RegExp {
  const pattern = escapeRegExp(name.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${pattern}\\b`, "gi");
}

/**
 * Replaces every occurrence of a known real name in `text` with its alias
 * code. "Known" = present in `mapping` (produced by `ensureAliases` for the
 * names relevant to THIS call, e.g. one project's `.name`/`.client`) — this
 * is a targeted substitution, not a scan of every alias ever minted.
 * Longest names first so "Power Breezer Industries" isn't partially
 * clobbered by a shorter "Power Breezer" entry that happens to share the
 * mapping. Tolerant of whitespace-only variants in the matched text (see
 * `buildNameRegex`) — NOT of abbreviations/misspellings/partial names.
 */
export function aliasText(text: string, mapping: Map<string, string> | Record<string, string>): string {
  if (!text) return text;
  const entries = toEntries(mapping)
    .filter(([name]) => name.trim().length > 0)
    .sort((a, b) => b[0].length - a[0].length);

  let result = text;
  for (const [name, code] of entries) {
    result = result.replace(buildNameRegex(name), code);
  }
  return result;
}

/** Reverses `aliasText` given the same (real name → alias) mapping. Word-boundary matched so "PROJ-1" (if it ever existed) can't eat into "PROJ-10". */
export function deAliasText(text: string, mapping: Map<string, string> | Record<string, string>): string {
  if (!text) return text;
  let result = text;
  for (const [name, code] of toEntries(mapping)) {
    if (!code) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(code)}\\b`, "g"), name);
  }
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * I/O wrapper — the only part of this module that touches Supabase
 * ──────────────────────────────────────────────────────────────────────────── */

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Ensures every name in `names` has an alias row for `kind`, minting new
 * ones as needed, and returns the resulting name→alias map (covers both
 * pre-existing and newly-created entries). Server-only — reads/writes
 * `smark_ai_aliases` through the service-role client (its RLS policy is
 * service-role-only; there is no per-user access path, by design).
 *
 * `client` is injectable for tests; defaults to `createServiceClient()` so
 * production call sites never need to think about it.
 */
export async function ensureAliases(
  kind: AliasKind,
  names: string[],
  client: SupabaseClient<Database> = createServiceClient(),
): Promise<Map<string, string>> {
  AliasEntityTypeSchema.parse(kind);
  const cleanNames = dedupeNames(names);
  if (cleanNames.length === 0) return new Map();

  const { data, error } = await client.from(TABLES.ai_aliases).select("entity_id, alias").eq("entity_type", kind);
  if (error) throw new Error(`ensureAliases: failed to read smark_ai_aliases: ${error.message}`);

  const { mapping, newRows } = computeAliasAssignments(kind, cleanNames, (data ?? []) as AliasRow[]);
  if (newRows.length === 0) return mapping;

  const { error: insertError } = await client
    .from(TABLES.ai_aliases)
    .insert(newRows.map((row) => ({ entity_type: kind, entity_id: row.entity_id, alias: row.alias })));

  if (insertError) {
    // Likely a concurrent caller minted the same entity between our read and
    // write (unique constraint on (entity_type, entity_id) or on alias) —
    // re-read once and recompute rather than failing the whole call over a
    // benign race. Single-owner admin usage keeps this vanishingly rare.
    const { data: retryData, error: retryError } = await client
      .from(TABLES.ai_aliases)
      .select("entity_id, alias")
      .eq("entity_type", kind);
    if (retryError) {
      throw new Error(`ensureAliases: insert failed (${insertError.message}) and re-read also failed: ${retryError.message}`);
    }
    return computeAliasAssignments(kind, cleanNames, (retryData ?? []) as AliasRow[]).mapping;
  }

  return mapping;
}

/* ────────────────────────────────────────────────────────────────────────────
 * buildPlannerContext — the structural whitelist (§12 requirement)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Deliberately narrow — has NO `description`/`notes`/`timeline_note` field.
 * A caller with a full `ProjectRow` in hand cannot accidentally leak those
 * into a planner payload through this type; there is nowhere to put them.
 */
export interface PlannerProjectInput {
  name: string;
  /** Free text on `smark_projects.client` — may be null (no client set yet). */
  client: string | null;
}

export interface PlannerBomLineInput {
  lineNo: number;
  /** Pass-through real (§12 exception — public catalog identifier). */
  mpn: string | null;
  /** Pass-through real (§12 exception). */
  lcscPn: string | null;
  value: string | null;
  /** Package/footprint — pass-through real (§12 exception; also the never-substitutable ladder rung, §7). */
  footprint: string | null;
  qty: number;
  /** Plain-English per-line note (may mention the client) — aliased before injection. */
  priorityNote: string | null;
}

export interface PlannerContextInput {
  project: PlannerProjectInput;
  bomName: string;
  buildQty: number;
  /** Distributor display names — pass-through real (§12 exception; also public). */
  distributorSequence: string[];
  /** Plain-English priorities from the ordering workspace — aliased before injection. */
  priorities: string | null;
  lines: PlannerBomLineInput[];
}

export interface PlannerContext {
  projectCode: string;
  clientCode: string | null;
  bomName: string;
  buildQty: number;
  distributorSequence: string[];
  priorities: string | null;
  lines: PlannerBomLineInput[];
}

/**
 * The ONE function bom-pipeline should call to turn a project + BOM lines
 * into something safe to hand to Opus. Structurally whitelisted (see
 * `PlannerProjectInput`) rather than a blacklist filter — there is no
 * `description`/`notes` field to forget to strip.
 *
 * `globalMapping` (optional) is merged UNDER the current project/client's own
 * fresh `ensureAliases` result — pass `buildGlobalAliasMapping`'s output here
 * so free-text `priorities`/`priorityNote` fields get scrubbed against EVERY
 * in-system project/client name, not just this call's own two names. Without
 * it, a priorities field that names some OTHER project/client verbatim (e.g.
 * "expedite like the Power Breezer order" on an unrelated BOM) sails through
 * un-aliased into the Opus/Sonnet prompt — see this package's report finding
 * #2. `buildGlobalDigestAliasMapping`/`aliasDigestForInjection` already apply
 * this same global treatment to the rules digest; this parameter lets callers
 * route priorities/notes through the identical scrub.
 */
export async function buildPlannerContext(
  input: PlannerContextInput,
  client?: SupabaseClient<Database>,
  globalMapping?: Map<string, string>,
): Promise<PlannerContext> {
  const projectAliases = await ensureAliases("project", [input.project.name], client);
  const clientAliases = input.project.client ? await ensureAliases("client", [input.project.client], client) : new Map<string, string>();
  const mapping = new Map<string, string>([...(globalMapping ?? []), ...projectAliases, ...clientAliases]);

  return {
    projectCode: mapping.get(input.project.name) ?? input.project.name,
    clientCode: input.project.client ? (mapping.get(input.project.client) ?? input.project.client) : null,
    bomName: input.bomName,
    buildQty: input.buildQty,
    distributorSequence: input.distributorSequence,
    priorities: input.priorities ? aliasText(input.priorities, mapping) : null,
    lines: input.lines.map((line) => ({
      ...line,
      priorityNote: line.priorityNote ? aliasText(line.priorityNote, mapping) : null,
    })),
  };
}

/** Convenience for logging/tests/CI leak-scans — a stable text rendering of a `PlannerContext`. Not the actual Opus prompt shape (bom-pipeline owns that). */
export function renderPlannerContextText(context: PlannerContext): string {
  return JSON.stringify(context, null, 2);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Global project/client alias mapping — shared by every call site that needs
 * to scrub or UN-scrub against the FULL set of in-system names, not just one
 * run's own project/client (report findings #1/#2).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Aliases against the FULL set of project names + distinct client values in
 * `smark_projects` — not just one run's own project/client. Two symmetric
 * uses:
 *  - OUTBOUND (enqueue.ts): scrub the global rules digest AND free-text
 *    priorities/per-line notes so no OTHER in-system project/client name can
 *    survive un-aliased into a Claude prompt (any rule/note can name any
 *    project verbatim — see `buildAliasedRunContext`'s own doc).
 *  - INBOUND (queries.ts): reverse the same mapping with `deAliasText` over
 *    every model-authored string before it reaches the UI (master narration,
 *    skip reasons, per-result "why") — the model was given aliased context
 *    built from this same global set, so its echoes can carry ANY of these
 *    codes back, not just the current run's own two.
 *
 * `entity_id` in `smark_ai_aliases` is a one-way hash of the real name (see
 * module doc) — there is no way to reverse alias→name without re-reading the
 * real names from `smark_projects` and re-running them through
 * `ensureAliases`, which is exactly what this function does.
 */
export async function buildGlobalAliasMapping(client: SupabaseClient<Database>): Promise<Map<string, string>> {
  const { data, error } = await client.from(TABLES.projects).select("name, client");
  if (error) throw new Error(`buildGlobalAliasMapping: failed to read smark_projects: ${error.message}`);
  const rows = (data ?? []) as { name: string; client: string | null }[];

  const projectNames = rows.map((r) => r.name);
  const clientNames = rows.map((r) => r.client).filter((c): c is string => Boolean(c));

  const [projectAliases, clientAliases] = await Promise.all([
    ensureAliases("project", projectNames, client),
    ensureAliases("client", clientNames, client),
  ]);

  return new Map<string, string>([...projectAliases, ...clientAliases]);
}
