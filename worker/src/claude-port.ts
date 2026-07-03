/**
 * worker/src/claude-port.ts — the low-level Claude transport.
 *
 * Deliberately raw `fetch` against `POST /v1/messages`, NOT the
 * `@anthropic-ai/sdk` package: this keeps the standalone worker's
 * dependency footprint at exactly one runtime package (`@supabase/supabase-js`
 * — see worker/package.json), matching docs/OWNERSHIP.md's "own package.json
 * — Bun runtime, minimal deps" and the build brief's "no bun add" rule (no
 * network-dependent install step is needed to get this file working). Bun
 * ships a global `fetch`, so this needs nothing extra. The wire shape below
 * (headers, body, response content blocks) is the documented, stable public
 * Messages API — see the Claude API skill's TypeScript README for the
 * canonical version this mirrors.
 *
 * `planner.ts` and `item-agent.ts` each own their OWN mock-vs-real
 * selection (checking `env.anthropicApiKey`) and their OWN prompt
 * construction — this module only knows how to make ONE completion call and
 * how to pull a JSON object back out of the response text. That split keeps
 * this file trivially unit-testable (pure request/response shape) while the
 * two callers stay readable (their prompts live where their JSON contracts —
 * `ClaudeMasterPlan` / the per-line verdict — are defined/consumed).
 */

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Non-streaming requests risk SDK/HTTP timeouts above ~16K output tokens
 * (Claude API skill, "128K output tokens" note). This worker never streams
 * a Claude response (planner/item-agent calls are small, structured JSON),
 * so every call is hard-capped well under that line regardless of what a
 * caller asks for — a caller wanting more must switch to `messages.stream`
 * in a future revision, not raise this constant.
 */
export const MAX_NON_STREAMING_TOKENS = 8000;

/**
 * Hard ceiling on how long a single Messages API call may hang before it's
 * treated as a retryable failure (report finding #5). Without this, a
 * silently-hung connection (half-open socket, stalled proxy — a common LLM-
 * API failure mode) never throws and never resolves: the retry loop below
 * only reacts to a thrown network error or a completed HTTP response, so the
 * `await` inside `item-agent.ts` — itself inside `worker/index.ts`'s
 * per-job `Promise.all`/concurrency-limited dispatch — would hang forever,
 * wedging the whole single-process poll loop (no further claiming, no
 * `releaseStaleClaims`, no run settling).
 */
const REQUEST_TIMEOUT_MS = 90_000;

export interface ClaudeCallOptions {
  model: string;
  system: string;
  userMessage: string;
  /** Hard-capped to `MAX_NON_STREAMING_TOKENS`. */
  maxTokens: number;
  /** low | medium | high | max — omit for the API default ("high"). Structured single-turn extraction rarely needs more than "medium". */
  effort?: "low" | "medium" | "high" | "max";
}

export interface ClaudeCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  stopReason: string;
}

export interface ClaudePort {
  complete(options: ClaudeCallOptions): Promise<ClaudeCallResult>;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Real transport — activates only when `ANTHROPIC_API_KEY` is present (worker/src/env.ts). */
export class AnthropicRestClaudePort implements ClaudePort {
  constructor(
    private readonly apiKey: string,
    private readonly maxRetries: number = 2,
  ) {}

  async complete(options: ClaudeCallOptions): Promise<ClaudeCallResult> {
    const maxTokens = Math.min(options.maxTokens, MAX_NON_STREAMING_TOKENS);
    const body = {
      model: options.model,
      max_tokens: maxTokens,
      system: options.system,
      messages: [{ role: "user", content: options.userMessage }],
      thinking: { type: "adaptive" },
      output_config: { effort: options.effort ?? "medium" },
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(2 ** attempt * 500);
      let response: Response;
      try {
        response = await fetch(MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // A timed-out AbortSignal throws a DOMException named "TimeoutError"
        // (or "AbortError" on older runtimes) — treat it exactly like a
        // network error: bounded, retryable, never an unbounded hang.
        lastError = error instanceof Error ? error : new Error(String(error));
        continue; // network error / timeout — retry
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`claude-port: HTTP ${response.status} from Messages API`);
        continue; // retryable per Claude API error-code reference
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "<no body>");
        throw new Error(`claude-port: HTTP ${response.status} (non-retryable): ${detail}`);
      }

      const parsed = (await response.json()) as AnthropicMessagesResponse;
      if (parsed.stop_reason === "refusal") {
        throw new Error("claude-port: model declined the request (stop_reason=refusal)");
      }
      const text = parsed.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
      return {
        text,
        tokensIn: parsed.usage.input_tokens,
        tokensOut: parsed.usage.output_tokens,
        stopReason: parsed.stop_reason,
      };
    }
    throw lastError ?? new Error("claude-port: exhausted retries with no captured error");
  }
}

/**
 * Extracts the first well-formed JSON object from an LLM's text output.
 * Tries a straight parse first (covers `output_config.format`/well-behaved
 * plain-JSON responses); falls back to a balanced-brace scan so prose like
 * "Here is the plan:\n{...}" or a ```json fenced block still parses. Throws
 * a descriptive error (never returns `null`) — callers decide how to react
 * to a malformed plan (retry the line, mark it unresolved), they never
 * silently proceed on bad data.
 */
export function extractJsonObject<T>(text: string): T {
  const direct = tryParse<T>(text.trim());
  if (direct !== undefined) return direct;

  const start = text.indexOf("{");
  if (start === -1) throw new Error(`claude-port: no JSON object found in response: ${text.slice(0, 200)}`);

  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        const result = tryParse<T>(candidate);
        if (result !== undefined) return result;
        break;
      }
    }
  }
  throw new Error(`claude-port: could not extract a valid JSON object from response: ${text.slice(0, 200)}`);
}

function tryParse<T>(candidate: string): T | undefined {
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return undefined;
  }
}
