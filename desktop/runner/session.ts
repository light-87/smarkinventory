/**
 * desktop/runner/session.ts — generates the Claude Code SESSION FOLDER for
 * one sourcing run: CLAUDE.md (ordering rules + BOM lines + REST candidates
 * + the strict results.json contract), .mcp.json (playwright MCP attached to
 * the dedicated Brave over CDP), pre-approved settings (no permission
 * prompts), and a seeded results.json. Pattern proven in
 * claude-session-control/server/browserCopilot.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkerRunConfig } from "../../types/worker";
import type { PrefetchLine } from "./prefetch";
import { CDP_PORT } from "./brave";

const MCP_VERSION = process.env.SMARKSTOCK_MCP_VERSION || "0.0.76"; // pinned, same as browserCopilot.ts

function mcpJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        browser: {
          command: "bun",
          args: ["x", `@playwright/mcp@${MCP_VERSION}`, "--cdp-endpoint", `http://127.0.0.1:${CDP_PORT}`],
        },
      },
    },
    null,
    2,
  );
}

function settingsJson(): string {
  return JSON.stringify(
    {
      permissions: { allow: ["mcp__browser", "Read", "Write", "Edit"] },
      enabledMcpjsonServers: ["browser"],
      // Multi-distributor browser sourcing WITH spec verification is too much for
      // Haiku — it filled 64 of 68 lines with empty candidates and fake-completed
      // (2026-07-20). Sonnet follows through and verifies. Explicit so the spawned
      // `claude` subprocess doesn't fall back to Opus by default.
      model: "sonnet",
    },
    null,
    2,
  );
}

function claudeMd(config: WorkerRunConfig, prefetch: PrefetchLine[]): string {
  const enabled = config.distributorSequence.filter((d) => d.enabled);
  const prefetchByLine = new Map(prefetch.map((p) => [p.bomLineId, p]));

  const lineBlocks = config.lines
    .map((l) => {
      const p = prefetchByLine.get(l.bomLineId);
      // Every remaining BOM column (supplier codes, RoHS, notes columns, …) —
      // the agent should see the whole row, nothing dropped.
      const extraLines = l.extra
        ? Object.entries(l.extra)
            .filter(([, v]) => v !== null && v !== "")
            .map(([k, v]) => `\n- ${k}: ${v}`)
            .join("")
        : "";
      return `### Line ${l.lineNo ?? "?"} — id \`${l.bomLineId}\`
- references: ${l.refDesignators ?? "-"} · quantity needed: **${l.qty}**${l.dnp ? " · **DNP — skip this line**" : ""}
- value: ${l.value ?? "-"} · footprint: ${l.footprint ?? "-"} · package: **${l.packageName ?? "UNKNOWN"}** · voltage: ${l.voltage ?? "-"}
- MPN: ${l.mpn ? `**${l.mpn}**` : "NONE — identify the part from value + package first"} · manufacturer: ${l.manufacturer ?? "-"}
- LCSC PN: ${l.lcscPn ? `**${l.lcscPn}** — source from LCSC directly (ordering rule 2)` : "-"} · part link: ${l.partLink ?? "-"}
- description: ${l.description ?? "-"}${extraLines}${l.priorityNote ? `\n- note: ${l.priorityNote}` : ""}
- VERIFIED API RESULTS (already fetched — trust these, do NOT re-browse these distributors for this line unless empty):
\`\`\`json
${JSON.stringify(p?.candidates ?? [], null, 1).slice(0, 6000)}
\`\`\`${p?.errors.length ? `\n- API errors (cover these by browsing): ${p.errors.join("; ")}` : ""}`;
    })
    .join("\n\n");

  return `# SmarkStock — BOM Sourcing Session

You are a purchasing agent for an electronics manufacturer in India. Source EVERY line below across these distributors, then write your findings to \`results.json\` in this folder. The distributor order for this run: **${enabled.map((d) => d.name).join(" → ")}**.

## Work unattended until every line is done — do NOT stop to ask
This is a fully unattended batch of **${config.lines.length} lines**. Work straight through all of them without pausing.
- NEVER stop to ask "should I continue?", "shall I proceed?", or which approach to take — the answer is always yes, keep going to the next line.
- Do NOT announce that you are finished, or set \`"complete": true\`, until \`results.json\` has a REAL result for EVERY one of the ${config.lines.length} lines. A line counts as done ONLY with at least one candidate, a DNP skip, or a genuine \`"candidates": []\` carrying a specific \`"notes"\` explaining what you searched — empty placeholders do NOT count. Counting entries is not enough.
- If a single line is hard (no results anywhere, a site won't load, a CAPTCHA you can't pass), write \`"candidates": []\` with a short \`"notes"\` and MOVE ON to the next line — one stuck line must never halt the batch.
- A line whose "VERIFIED API RESULTS" block is empty is normal (e.g. LCSC/Unikey are browse-only) — just source that line in the browser; it is not an error and not a reason to stop.

## Browser
You drive a dedicated Brave window through the **browser** MCP tools (Playwright over CDP — the window is already open and attached; the tools just work). Use it for LCSC and Unikey (no APIs), and for any distributor whose API results below are empty or errored. Search URLs: LCSC \`https://www.lcsc.com/search?q=…\`, Unikey \`https://www.unikeyic.com/search?q=…\`, DigiKey \`https://www.digikey.com/en/products/result?keywords=…\`, Mouser \`https://www.mouser.com/c/?q=…\`, element14 \`https://in.element14.com/search?st=…\`. Prefer the text snapshot over screenshots; act directly; a site that won't load after two tries is "unreachable", move on.

## Ordering rules — apply in this order to every line
1. **MPN** given → exact MPN match first; a variant/equivalent only if the exact MPN is nowhere in stock (mark it clearly).
2. **LCSC PN** given (Cxxxxx) → source from LCSC ONLY.
3. **Value semantics** — resistor: value(/voltage), tolerance, (wattage); capacitor: value/voltage, dielectric (X7R/X5R matters).
4. **PACKAGE MATCH IS MANDATORY** — a different package disqualifies a candidate, no exceptions.
5. Part status: prefer active/stocked; avoid EOL/NRND unless nothing else exists.
6. Stock must cover the needed quantity.
7. **Lowest unit cost at the needed quantity wins** among qualifying candidates (element14 prices are INR; LCSC/DigiKey/Mouser USD; ₹ ≈ USD × 84).

Never invent a part number, price, stock figure or URL — only what the API results below or a live page actually showed.

## Output contract — results.json (STRICT)
Update \`results.json\` **after finishing EACH line** (never wait until the end), keeping this exact shape:
\`\`\`json
{
  "complete": false,
  "lines": {
    "<line id from the headings below>": {
      "searchTerm": "<what you searched>",
      "notes": "<one line: anything the buyer must know, or null>",
      "skipped": null,
      "candidates": [
        {
          "distributor": "LCSC|DigiKey|Mouser|element14|Unikey",
          "mpn": "<exact MPN from the page/API>",
          "package": "<package>",
          "stock": 27150,
          "price": 0.0313,
          "currency": "USD",
          "qtyBreaks": [{"qty": 50, "unitPrice": 0.0313}],
          "status": "active",
          "url": "https://…",
          "recommended": false,
          "why": "<one sentence — REQUIRED on the recommended candidate>"
        }
      ]
    }
  }
}
\`\`\`
- Include EVERY distributor candidate you verified (API or page), not just the winner; mark exactly ONE \`"recommended": true\` per line (the ordering-rules winner). A line with nothing anywhere: \`"candidates": []\` and \`"notes"\` explaining. A DNP line: \`"skipped": "DNP"\`.
- \`status\` must be "active", "nrnd", "eol" or null. Prices are NUMBERS (no $ signs).
- When ALL lines are present, set \`"complete": true\` and tell the user you're done.

## The BOM — ${config.lines.length} lines
${config.overallPriorities ? `Overall priorities: ${config.overallPriorities}\n` : ""}${config.rulesDigest ? `\n## Buyer's standing rules (learned from past orders — honor these)\n${config.rulesDigest}\n` : ""}
${lineBlocks}
`;
}

export interface GeneratedSession {
  dir: string;
  resultsFile: string;
}

export function generateSession(baseDir: string, config: WorkerRunConfig, prefetch: PrefetchLine[]): GeneratedSession {
  const dir = path.join(baseDir, config.runId);
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), claudeMd(config, prefetch), "utf8");
  writeFileSync(path.join(dir, ".mcp.json"), mcpJson(), "utf8");
  writeFileSync(path.join(dir, ".claude", "settings.local.json"), settingsJson(), "utf8");
  // Persist the run config so "Sync latest again" (--upload-only) can rebuild
  // the transform (distributor name→id map etc.) from disk without the server.
  writeFileSync(path.join(dir, "config.json"), JSON.stringify(config), "utf8");
  const resultsFile = path.join(dir, "results.json");
  writeFileSync(resultsFile, JSON.stringify({ complete: false, lines: {} }, null, 2), "utf8");
  return { dir, resultsFile };
}
