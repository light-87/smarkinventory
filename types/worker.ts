/**
 * types/worker.ts — the ONE shared types file the `worker` package owns
 * (docs/OWNERSHIP.md → worker). Read by: `worker/**` (the standalone
 * Browser-Worker service) AND by the app packages that enqueue runs for it
 * (bom-pipeline's `lib/runs/**`) or that feed it context (ai-memory's rules
 * digest, search-notifications' nothing — worker never calls notifications
 * directly, see docs/spike-browser-worker.md "notes for integrator").
 *
 * Deliberately does NOT redeclare `smark_agent_runs` / `smark_order_jobs` /
 * `smark_agent_results` ROW shapes — those are canonical in `types/db.ts`
 * (integrator-owned; "Does NOT own: smark_agent_* table shapes"). This file
 * is one layer up: the JSON *payload* contracts that flow THROUGH those
 * tables' jsonb columns (`smark_agent_runs.plan`, `smark_order_jobs.plan`)
 * and between the app and the worker at enqueue time. The worker's own
 * internal DB-row reader/writer code (worker/src/*) declares small local
 * structural interfaces for the exact columns it touches — see the comment
 * atop worker/src/db.ts for why that's intentional, not drift.
 *
 * Alias-layer contract (FEATURES.md §12, SCHEMA.md §7): every string field
 * below that could carry a client/project/product name MUST already be
 * aliased by the app before it reaches the worker — the worker never sees
 * real client/project names, and never de-aliases (that only happens
 * server-side in the app when rendering results back to a human). The
 * pass-through-real exception set (public catalog identifiers, search
 * cannot work without them) is: `mpn`, `lcscPn`, `packageName`,
 * `manufacturer`, distributor `name`. Everything else that could name a
 * client/project (aliasedProjectLabel, overallPriorities, priorityNote,
 * rulesDigest) is already a code (`PROJ-03`) or has had names stripped by
 * the app's alias layer before this contract is populated. Project
 * descriptions/notes are never sent at all (§12) — there is no field for
 * them here on purpose.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Enums — mirror the DB CHECK constraints (SCHEMA.md §4/§5) as string
 * literal unions. Duplicated deliberately (see file header) — if the DB
 * enum changes, the integrator updates types/db.ts AND pings the worker
 * owner to update these; they are not meant to auto-drift-detect.
 * ──────────────────────────────────────────────────────────────────────────── */

/** FEATURES.md §7 — the standard search ladder. `package` is mandatory, never substitutable. */
export type OrderingRuleKey =
  | "mpn"
  | "lcsc"
  | "value"
  | "package"
  | "status"
  | "qty"
  | "cost"
  | "custom";

/** `smark_distributors.api_type`. */
export type DistributorApiType = "rest" | "browse" | "none";

/** Distributor-reported lifecycle status. */
export type PartLifecycleStatus = "active" | "nrnd" | "eol";

/** `smark_agent_results.mpn_match`. */
export type MpnMatchQuality = "exact" | "approx" | "none";

/** FEATURES.md §5.9 / §16 tier knob — ALWAYS clamped by the fixed per-site cap (§15). */
export type ConcurrencyPreset = "economy" | "balanced" | "thorough";

/** `smark_order_jobs.status` — worker's own view of the claim-queue lifecycle. */
export type JobStatus = "queued" | "claimed" | "done" | "failed";

/** `smark_agent_runs.status` — worker's own view of the run lifecycle. */
export type RunStatus = "planning" | "running" | "review" | "done" | "failed";

/* ────────────────────────────────────────────────────────────────────────────
 * Concurrency tiers — shared default so the Ordering Workspace's tier
 * picker (bom-pipeline) and the worker's fan-out/depth math never drift
 * apart on what "Economy/Balanced/Thorough" numerically means. The PER-SITE
 * CAP (worker/src/caps.ts) is a SEPARATE, always-lower ceiling that clamps
 * whatever this table produces (FEATURES §15 — "fixed per-site concurrency
 * cap ALWAYS beats the user knob").
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ConcurrencyTierConfig {
  /** How many bom-lines the worker fans out to item-agents in parallel. */
  fanoutWidth: number;
  /** How many ladder rungs / distributor attempts one item-agent tries before giving up on a line. */
  depthPerItem: number;
}

export const CONCURRENCY_TIER_PRESETS: Readonly<Record<ConcurrencyPreset, ConcurrencyTierConfig>> = {
  economy: { fanoutWidth: 2, depthPerItem: 2 },
  balanced: { fanoutWidth: 3, depthPerItem: 3 },
  thorough: { fanoutWidth: 6, depthPerItem: 5 },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Distributors
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A distributor descriptor the app hands the worker at enqueue time. The
 * worker routes to a `DistributorClient` implementation BY NAME (see
 * `worker/src/distributors/index.ts`) — `id` is carried through purely so
 * the worker can stamp `smark_agent_results.distributor_id` on write
 * without needing its own read of `smark_distributors` (though it may
 * read that table too, via service-role, for anything the app didn't
 * already resolve — see worker/src/db.ts).
 */
export interface DistributorDescriptor {
  /** smark_distributors.id — echoed back on every smark_agent_results row. */
  id: string;
  /** "Digikey" | "Mouser" | "element14" | "LCSC" | "Unikey" | any Settings-added name — public, pass-through-real. */
  name: string;
  apiType: DistributorApiType;
  /** Position in the per-BOM sequence (drag-reordered in the workspace); lower = tried first. */
  rank: number;
  enabled: boolean;
}

/** Fixed, worker-owned, NEVER user-overridable (FEATURES §15) — keyed by distributor `name`. */
export type PerSiteCapMap = Readonly<Record<string, number>>;

/* ────────────────────────────────────────────────────────────────────────────
 * Run enqueue contract — what the app writes (aliased) for the worker to
 * plan + fan out. One `WorkerRunConfig` corresponds to one `smark_agent_runs`
 * row; the app is responsible for creating that row (status "planning")
 * BEFORE enqueueing, and for writing one `smark_order_jobs` row per line in
 * `lines` (the worker does not create jobs for itself).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One BOM line the worker needs to source. In-stock lines that short-circuit
 * (FEATURES §5.10 "✓ Already in stock") are NOT sent here at all — the app
 * renders those directly from reconcile data without worker involvement;
 * `lines` only ever contains `to_order` / contested lines. Every numeric
 * `qty` here is ALREADY multiplied by the BOM's `build_qty` (R2-27) — the
 * worker never re-applies that multiplier.
 */
export interface WorkerBomLine {
  /** smark_bom_lines.id */
  bomLineId: string;
  /** Raw reference designators ("C3,C69…") — public, not client-identifying. */
  refDesignators: string | null;
  /** Need, already × build_qty. 0 for DNP lines — nobody intends to buy them. */
  qty: number;
  value: string | null;
  /** Renamed from the DB's `package` column (reserved word) — mandatory rung, never substitutable. */
  packageName: string | null;
  voltage: string | null;
  mpn: string | null;
  manufacturer: string | null;
  lcscPn: string | null;
  /** Per-line plain-English note from the BOM sheet ("LCSC only") — ALREADY aliased. */
  priorityNote: string | null;
  // ── Complete-file fields (manual-test decision: "the agent gets the whole
  // BOM"). All optional so run configs stored before this change still parse.
  /** The sheet's own `#` — lets the model reference lines the way the file does. */
  lineNo?: number | null;
  /** Raw footprint cell ("SMARKKicadLib:C1206") — `packageName` is the derived facet. */
  footprint?: string | null;
  /** Do-Not-Populate flag from the sheet — the planner must route these to "skip". */
  dnp?: boolean;
  /** Component description from the sheet — free text, ALREADY aliased. */
  description?: string | null;
  /** Direct distributor product URL from the sheet — public, pass-through real. */
  partLink?: string | null;
  /** Custom template columns (key → value) — string values ALREADY aliased. */
  extra?: Record<string, string | number | boolean | null> | null;
}

/**
 * Informational summary of a line that is already fully in stock — included
 * in the run config so the master planner sees the COMPLETE uploaded file,
 * but these have no `smark_order_jobs` row and must never appear in the
 * plan's `searches`/`skip` output. Public-safe fields only (no free text).
 */
export interface InStockLineSummary {
  lineNo: number | null;
  refDesignators: string | null;
  mpn: string | null;
  value: string | null;
  /** Need, already × build_qty. */
  qty: number;
}

/** One run's full, already-aliased configuration (FEATURES §6/§9/§12). */
export interface WorkerRunConfig {
  /** smark_agent_runs.id — the app creates this row (status "planning") before enqueueing. */
  runId: string;
  /** smark_boms.id */
  bomId: string;
  /** e.g. "PROJ-03" — NEVER the real project/client name (§12). Purely for narration/logging. */
  aliasedProjectLabel: string;
  /** Ordered, per-BOM sequence; only `enabled` entries are searched. */
  distributorSequence: DistributorDescriptor[];
  /** Free-text priorities, ALREADY aliased — sheet-prefilled overall notes (no client names). */
  overallPriorities: string;
  /** `smark_learned_rules_doc.content` for the active version, ALREADY aliased (R2-17). */
  rulesDigest: string;
  rulesDigestVersion: number | null;
  /** Enabled rungs in rank order; `"package"` is always present and mandatory. */
  orderingLadder: OrderingRuleKey[];
  concurrencyPreset: ConcurrencyPreset;
  /** To-order lines only — see WorkerBomLine doc. */
  lines: WorkerBomLine[];
  /** Already-stocked lines, context only (see InStockLineSummary doc). Optional: absent on pre-change stored configs. */
  inStockLines?: InStockLineSummary[];
  /** FEATURES §15/§18 — per-run ₹ ceiling; the worker MUST abort (not silently overspend) past this. */
  rupeeCeiling: number;
}

/**
 * The full contents of `smark_agent_runs.plan` (jsonb) — an ENVELOPE holding
 * BOTH the input config the app wrote at enqueue time AND the Opus output
 * once planning completes, so one column can serve both without a new
 * migration. Enqueue contract (bom-pipeline's `lib/runs/**`, not yet built
 * — see docs/spike-browser-worker.md "notes for the integrator"): insert
 * `smark_agent_runs` with `status: "planning"` and
 * `plan: { config: <WorkerRunConfig>, masterPlan: null } satisfies WorkerRunPlanColumn`,
 * plus one `smark_order_jobs` row per to-order line (`bom_line_id`, `run_id`,
 * `status: "queued"`, `plan: null`). The worker (`planner.ts`) reads
 * `plan.config`, calls Opus once, and overwrites the column with
 * `{ config, masterPlan }` before flipping `status` to `"running"`.
 */
export interface WorkerRunPlanColumn {
  config: WorkerRunConfig;
  masterPlan: ClaudeMasterPlan | null;
  /**
   * App-side metadata the worker PRESERVES when overwriting the envelope
   * with the master plan (it never reads it): buildQtyAtRun, and lineLimit
   * for /ai_orc sandbox runs (F-007).
   */
  appMeta?: Record<string, unknown> | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The Opus master plan — one call per run, Opus NEVER fetches distributor
 * data (FEATURES §4). Stored (inside the envelope above) into
 * `smark_agent_runs.plan`.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Traceability breadcrumb — "which rule hit which line" (FEATURES §9/§10 anti-drift). */
export interface RuleHit {
  /** smark_learned_rules.id, if the digest names one explicitly; else a short synthetic key. */
  ruleId: string;
  /** Short human summary, e.g. "prefer LCSC for GCU 0.1µF caps". */
  ruleSummary: string;
}

/** Opus's per-line search instruction. */
export interface PlannedSearch {
  bomLineId: string;
  /** Distributor NAMES in the order to try for THIS line — a reorder/subset of the run's sequence. */
  distributorOrder: string[];
  /**
   * Master-authored EXACT query string the item agent should search with
   * (typed into a browse site's search box / used as the REST keyword) —
   * usually the MPN, but the master may sharpen it (e.g. strip a packing
   * suffix, or use value+package for MPN-less lines). Optional: absent on
   * pre-change stored plans; executors fall back to their own derivation.
   */
  searchTerm?: string | null;
  /** Short "why" basis for this line's plan (surfaces as run-log narration). */
  notes: string | null;
  ruleHit: RuleHit | null;
}

/** Opus decided a line needs no distributor search at all (beyond app-side skip-buy). */
export interface SkipDecision {
  bomLineId: string;
  reason: string;
  ruleHit: RuleHit | null;
}

/** The full JSON object Opus returns from ONE planning call. */
export interface ClaudeMasterPlan {
  searches: PlannedSearch[];
  skip: SkipDecision[];
  /** Master-card typewriter narration basis, e.g. "Planned 12 searches · dispatched 12 item agents." */
  narration: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-line results — Sonnet item-agent output, one call per line, AFTER it
 * has walked the ladder across the distributor sequence via DistributorClient.
 * Upserted into `smark_agent_results` keyed (run_id, bom_line_id,
 * distributor_id) — IDEMPOTENT (a re-claimed job never duplicates rows).
 * ──────────────────────────────────────────────────────────────────────────── */

export interface QtyBreak {
  qty: number;
  unitPrice: number;
}

/** One (line, distributor) comparison row — maps ~1:1 onto `smark_agent_results`. */
export interface DistributorListingResult {
  bomLineId: string;
  distributorId: string;
  distributorName: string;
  price: number | null;
  currency: string;
  qtyBreaks: QtyBreak[];
  stockQty: number | null;
  mpnMatch: MpnMatchQuality;
  /** Mandatory rung (FEATURES §7/§8) — NEVER true unless the normalized package matched exactly. */
  packageMatch: boolean;
  partStatus: PartLifecycleStatus | null;
  orderLink: string | null;
  isRecommended: boolean;
  /** 0–100 agent confidence. */
  confidence: number;
  /** "AI · why" lane footer — basis of the pick / faults of the others. */
  why: string;
  /** Full scraped/API payload — server-controlled, never sent to the client unfiltered. */
  raw: unknown;
}

/** One line is fully done: either it produced comparison rows, or it was skipped/already-stocked. */
export interface ItemAgentOutcome {
  bomLineId: string;
  results: DistributorListingResult[];
  skipped: SkipDecision | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cost — ₹ estimate/ceiling bookkeeping (FEATURES §15/§18).
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  estimatedRupees: number;
  tokenUsage: TokenUsage;
}

/* ────────────────────────────────────────────────────────────────────────────
 * BrowserDriver wire contract (FEATURES §0/§4 — LCSC/Unikey path).
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BrowserSearchListing {
  title: string;
  price: number | null;
  currency: string;
  stockQty: number | null;
  url: string;
  raw: unknown;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Job claim contract — the worker's own view of a claimed unit of work.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ClaimedJob {
  /** smark_order_jobs.id */
  jobId: string;
  runId: string;
  bomLineId: string;
  /** This line's slice of the master plan, if planning already ran; null if not yet planned. */
  plannedSearch: PlannedSearch | null;
  attempts: number;
}
