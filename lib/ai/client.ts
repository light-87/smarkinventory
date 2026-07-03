/**
 * lib/ai/client.ts — the Claude client seam (docs/OWNERSHIP.md: ai-memory
 * owns `lib/ai/**`, imported read-only by cart-orders/bom-pipeline/receive).
 *
 * `ClaudePort` is the ONE interface every caller depends on — never
 * `fetch("https://api.anthropic.com/...")` or a raw SDK client directly.
 * Two implementations, picked by `getClaude()`:
 *
 *  - `AnthropicAdapter` — real calls. `@anthropic-ai/sdk` is NOT installed
 *    (CLAUDE.md: no `bun add` without integrator sign-off), so this talks
 *    to `POST https://api.anthropic.com/v1/messages` over plain `fetch`
 *    with the exact headers/body shape the REST API expects
 *    (`x-api-key`, `anthropic-version: 2023-06-01`, JSON body). Model IDs
 *    come from `CLAUDE_MODEL_MASTER` / `CLAUDE_MODEL_ITEM` (FEATURES.md §3
 *    env block) with current-generation defaults (`claude-opus-4-8` /
 *    `claude-sonnet-5`) — no SDK aliasing, no date-suffixed IDs.
 *
 *  - `MockAdapter` — deterministic fixture responses keyed by prompt
 *    `kind`, used whenever `ANTHROPIC_API_KEY` is absent (true today: "NO
 *    LIVE KEYS EXIST"). This is what makes the enqueue → claim → plan →
 *    item results → stream → review pipeline exercisable end-to-end for the
 *    E2E gate without spending a rupee or touching the network.
 *
 * `getClaude()` is the factory every feature package should call — never
 * `new AnthropicAdapter()` / `new MockAdapter()` directly, so swapping the
 * selection rule (or injecting a test double) is a one-file change.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Wire-ish shapes (deliberately small — this is not a full SDK surface)
 * ──────────────────────────────────────────────────────────────────────────── */

export type ClaudeRole = "user" | "assistant";

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface ClaudeMessage {
  role: ClaudeRole;
  /** Plain string for text-only turns; block array for vision (receipt photos). */
  content: string | ClaudeContentBlock[];
}

/**
 * Selects both the model tier (FEATURES.md §1: "Opus = master planner + rule
 * learning; Sonnet = per-item search agents; small calls for MPN
 * normalization + receipt extraction") and — in `MockAdapter` — which
 * fixture to return. Add a kind here before using it; don't stringly-type
 * ad hoc kinds at call sites.
 */
export type ClaudePromptKind = "planner" | "item-search" | "extract-receipt" | "normalize-mpn";

export interface ClaudeCompleteRequest {
  kind: ClaudePromptKind;
  messages: ClaudeMessage[];
  system?: string;
  /** Defaults to a per-kind ceiling (see AnthropicAdapter.DEFAULT_MAX_TOKENS). */
  maxTokens?: number;
  /** Escape hatch — overrides the kind→model resolution. Rarely needed. */
  model?: string;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeCompleteResponse {
  /** Concatenated text content of the response (thinking blocks excluded). */
  text: string;
  model: string;
  stopReason: string | null;
  usage: ClaudeUsage | null;
  /** Safety-classifier decline (`stop_reason: "refusal"`) — see AnthropicAdapter below. `text` is empty when true. */
  refused: boolean;
  refusalCategory: string | null;
  /** True when `MockAdapter` served this — callers surfacing cost/telemetry should skip mocked calls. */
  mocked: boolean;
}

export interface ClaudePort {
  complete(request: ClaudeCompleteRequest): Promise<ClaudeCompleteResponse>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * AnthropicAdapter — real REST calls, no SDK
 * ──────────────────────────────────────────────────────────────────────────── */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Hard ceiling on how long one Messages API call may hang (report finding
 * #5's `lib/ai/client.ts` half — same gap as `worker/src/claude-port.ts`).
 * Without an abort signal, a silently-hung connection never throws and never
 * resolves, tying up the caller (e.g. the extract-receipt route) until the
 * platform function timeout instead of failing fast with a clear error.
 */
const REQUEST_TIMEOUT_MS = 90_000;

const DEFAULT_MASTER_MODEL = "claude-opus-4-8";
const DEFAULT_ITEM_MODEL = "claude-sonnet-5";

/** Per-kind ceilings — small structured-extraction calls don't need planner-sized budgets. */
const DEFAULT_MAX_TOKENS: Record<ClaudePromptKind, number> = {
  planner: 8000,
  "item-search": 4000,
  "extract-receipt": 2048,
  "normalize-mpn": 512,
};

/** Effort tuning per kind (output_config.effort — GA, no beta header). */
const DEFAULT_EFFORT: Record<ClaudePromptKind, "low" | "medium" | "high"> = {
  planner: "high",
  "item-search": "medium",
  "extract-receipt": "low",
  "normalize-mpn": "low",
};

export interface AnthropicAdapterConfig {
  apiKey?: string;
  masterModel?: string;
  itemModel?: string;
  /** Injectable for tests — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface AnthropicMessagesResponseBody {
  model?: string;
  stop_reason?: string | null;
  stop_details?: { type: string; category?: string | null } | null;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

/**
 * Talks to `POST /v1/messages` directly. Kept deliberately small: adaptive
 * thinking always on (GA, no beta header — valid on both Opus 4.8 and
 * Sonnet 5), `output_config.effort` tuned per kind, no sampling params (not
 * needed for structured/deterministic tasks), no streaming (every caller in
 * this codebase wants a single complete result, not token-by-token UI).
 */
export class AnthropicAdapter implements ClaudePort {
  private readonly apiKey: string;
  private readonly masterModel: string;
  private readonly itemModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnthropicAdapterConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AnthropicAdapter: ANTHROPIC_API_KEY is not set — use getClaude() instead of constructing this directly, it falls back to MockAdapter automatically.",
      );
    }
    this.apiKey = apiKey;
    this.masterModel = config.masterModel ?? process.env.CLAUDE_MODEL_MASTER ?? DEFAULT_MASTER_MODEL;
    this.itemModel = config.itemModel ?? process.env.CLAUDE_MODEL_ITEM ?? DEFAULT_ITEM_MODEL;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Opus for planning; Sonnet for everything else (§1: "small calls" share the item-tier model — no third env var exists). */
  private modelFor(kind: ClaudePromptKind, override?: string): string {
    if (override) return override;
    return kind === "planner" ? this.masterModel : this.itemModel;
  }

  async complete(request: ClaudeCompleteRequest): Promise<ClaudeCompleteResponse> {
    const model = this.modelFor(request.kind, request.model);
    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS[request.kind],
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: "adaptive" },
      output_config: { effort: DEFAULT_EFFORT[request.kind] },
    };
    if (request.system) body.system = request.system;

    const res = await this.fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let json: AnthropicMessagesResponseBody;
    try {
      json = (await res.json()) as AnthropicMessagesResponseBody;
    } catch {
      throw new Error(`AnthropicAdapter: non-JSON response from Claude API (HTTP ${res.status}).`);
    }

    if (!res.ok) {
      throw new Error(`AnthropicAdapter: Claude API error (HTTP ${res.status}): ${json.error?.message ?? "unknown error"}`);
    }

    // Always check stop_reason before reading content — a refusal can carry
    // an empty content array (pre-output decline) and must never be treated
    // as a successful empty answer by the caller.
    const refused = json.stop_reason === "refusal";
    const text = refused
      ? ""
      : (json.content ?? [])
          .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("\n");

    return {
      text,
      model: json.model ?? model,
      stopReason: json.stop_reason ?? null,
      usage: json.usage
        ? { inputTokens: json.usage.input_tokens ?? 0, outputTokens: json.usage.output_tokens ?? 0 }
        : null,
      refused,
      refusalCategory: refused ? (json.stop_details?.category ?? null) : null,
      mocked: false,
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * MockAdapter — deterministic fixtures, no network, no key required
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A recognizable "seeded demo receipt" — any extraction input containing
 * this marker text gets the precise matching fixture below. Anything else
 * falls through to `genericReceiptFixture`, so the pipeline still produces
 * plausible structured output for ad hoc/manual testing, not just the one
 * canonical sample.
 */
export const MOCK_DEMO_RECEIPT_TEXT = `Digikey Order Confirmation — PO# DK-DEMO-0001
1  STM32F103C8T6                x100   @ 42.50   4250.00
2  0603 4.7k 1% resistor        x500   @ 0.35     175.00
3  0.1uF 50V X7R capacitor      x500   @ 1.10     550.00
Subtotal 4975.00  Shipping 250.00  Total 5225.00`;

const MOCK_DEMO_RECEIPT_FIXTURE = {
  lines: [
    { desc: "STM32F103C8T6", qty: 100, unit_price: 42.5 },
    { desc: "0603 4.7k 1% resistor", qty: 500, unit_price: 0.35 },
    { desc: "0.1uF 50V X7R capacitor", qty: 500, unit_price: 1.1 },
  ],
  total: 5225.0,
};

/** Very small line-item scraper: `desc  qty  price` per line, tab/space separated. Best-effort, not a real OCR/parse pipeline. */
function genericReceiptFixture(text: string): { lines: Array<{ desc: string; qty: number; unit_price: number }>; total: number | null } {
  const lines: Array<{ desc: string; qty: number; unit_price: number }> = [];
  const lineRe = /^(.*?)[\s,|]+(?:x\s*)?(\d+(?:\.\d+)?)\s*(?:@|x|units?|pcs?)?\s*(\d+(?:\.\d+)?)\s*$/i;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = lineRe.exec(trimmed);
    if (!match) continue;
    const [, descRaw, qtyRaw, priceRaw] = match;
    const desc = descRaw!.trim().replace(/^\d+[.)]\s*/, "");
    if (!desc) continue;
    lines.push({ desc, qty: Number.parseFloat(qtyRaw!), unit_price: Number.parseFloat(priceRaw!) });
  }
  const totalMatch = /total\s*[:\s]\s*(\d+(?:\.\d+)?)/i.exec(text);
  return { lines, total: totalMatch ? Number.parseFloat(totalMatch[1]!) : null };
}

function mockExtractReceipt(request: ClaudeCompleteRequest): string {
  const textBlock = request.messages
    .flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((b) => b.type === "text").map((b) => b.text)))
    .join("\n");

  if (textBlock.includes("Digikey Order Confirmation") || textBlock.includes("DK-DEMO-0001")) {
    return JSON.stringify(MOCK_DEMO_RECEIPT_FIXTURE);
  }
  const hasImageOnly = request.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image"));
  if (hasImageOnly && !textBlock.trim()) {
    // No OCR in mock mode — the canonical demo fixture keeps the pipeline exercisable end-to-end.
    return JSON.stringify(MOCK_DEMO_RECEIPT_FIXTURE);
  }
  return JSON.stringify(genericReceiptFixture(textBlock));
}

function mockNormalizeMpn(request: ClaudeCompleteRequest): string {
  const raw = request.messages
    .flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((b) => b.type === "text").map((b) => b.text)))
    .join(" ");
  const match = /normalize:\s*(.+)$/im.exec(raw);
  const candidate = (match?.[1] ?? raw).trim();
  const normalized = candidate
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-ND$/, ""); // Digikey catalog-suffix stripped, e.g. "296-1234-1-ND" → "296-1234-1"
  return JSON.stringify({ normalized, confidence: normalized === candidate.toUpperCase() ? 0.95 : 0.7 });
}

const MOCK_PLANNER_FIXTURE = JSON.stringify({
  narration: "Plan drafted from the reconciled to-order lines, standard search ladder, and the active rules digest.",
  lineOrder: [] as string[],
});

const MOCK_ITEM_SEARCH_FIXTURE = JSON.stringify({
  recommended: null,
  note: "Mock item-search result — no live distributor call was made.",
});

/** Deterministic, network-free stand-in for `AnthropicAdapter` — see module doc. */
export class MockAdapter implements ClaudePort {
  async complete(request: ClaudeCompleteRequest): Promise<ClaudeCompleteResponse> {
    const model = request.model ?? (request.kind === "planner" ? "mock-claude-opus" : "mock-claude-sonnet");
    const text = this.fixtureFor(request);
    return {
      text,
      model,
      stopReason: "end_turn",
      usage: { inputTokens: estimateTokens(request), outputTokens: estimateTokens(text) },
      refused: false,
      refusalCategory: null,
      mocked: true,
    };
  }

  private fixtureFor(request: ClaudeCompleteRequest): string {
    switch (request.kind) {
      case "extract-receipt":
        return mockExtractReceipt(request);
      case "normalize-mpn":
        return mockNormalizeMpn(request);
      case "planner":
        return MOCK_PLANNER_FIXTURE;
      case "item-search":
        return MOCK_ITEM_SEARCH_FIXTURE;
      default:
        return "{}";
    }
  }
}

function estimateTokens(input: ClaudeCompleteRequest | string): number {
  const text =
    typeof input === "string"
      ? input
      : input.messages
          .flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((b) => b.type === "text").map((b) => b.text)))
          .join(" ");
  // Rough char/4 estimate — mock usage numbers are for UI plumbing/cost-meter
  // shape only, never billed against, so accuracy beyond "plausible" doesn't matter.
  return Math.max(1, Math.ceil(text.length / 4));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The ONE way feature packages should obtain a `ClaudePort`. Picks
 * `AnthropicAdapter` when `ANTHROPIC_API_KEY` is set, `MockAdapter`
 * otherwise (true for every environment today — "NO LIVE KEYS EXIST").
 * Pass an explicit instance in tests instead of stubbing this factory.
 */
export function getClaude(): ClaudePort {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicAdapter() : new MockAdapter();
}
