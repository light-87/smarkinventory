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
      return `### Line ${l.lineNo ?? "?"} — id \`${l.bomLineId}\`
- references: ${l.refDesignators ?? "-"} · quantity needed: **${l.qty}**${l.dnp ? " · **DNP — skip this line**" : ""}
- value: ${l.value ?? "-"} · footprint: ${l.footprint ?? "-"} · package: **${l.packageName ?? "UNKNOWN"}** · voltage: ${l.voltage ?? "-"}
- MPN: ${l.mpn ? `**${l.mpn}**` : "NONE — identify the part from value + package first"} · manufacturer: ${l.manufacturer ?? "-"}
- description: ${l.description ?? "-"}${l.priorityNote ? `\n- note: ${l.priorityNote}` : ""}
- VERIFIED API RESULTS (already fetched — trust these, do NOT re-browse these distributors for this line unless empty):
\`\`\`json
${JSON.stringify(p?.candidates ?? [], null, 1).slice(0, 6000)}
\`\`\`${p?.errors.length ? `\n- API errors (cover these by browsing): ${p.errors.join("; ")}` : ""}`;
    })
    .join("\n\n");

  return `# SmarkStock — BOM Sourcing Session

You are a purchasing agent for an electronics manufacturer in India. Source EVERY line below across these distributors, then write your findings to \`results.json\` in this folder. The distributor order for this run: **${enabled.map((d) => d.name).join(" → ")}**.

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
  const resultsFile = path.join(dir, "results.json");
  writeFileSync(resultsFile, JSON.stringify({ complete: false, lines: {} }, null, 2), "utf8");
  return { dir, resultsFile };
}
