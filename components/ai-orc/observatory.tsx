"use client";

/**
 * components/ai-orc/observatory.tsx — the /ai_orc client. Polls
 * /api/ai-orc/state every 3s (paused while the tab is hidden) and renders:
 *   1. Worker fleet — one card per heartbeating process: RAM (rss vs system),
 *      CPU %, active item agents, mock/live mode, browser gate.
 *   2. Capacity math — the fixed ceilings that make "99 parallel browser
 *      agents" impossible by construction (tiers, per-site caps, gates).
 *   3. Runs — newest first; selecting one loads the deep dive: the EXACT
 *      Opus/Sonnet prompts (re-rendered via worker/src/prompts.ts from the
 *      stored config) and one lane per BOM line with plan → results → why.
 * Everything shown is the ALIASED truth — precisely what the models see.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatINR, formatNumber } from "@/lib/format";
import { SandboxPanel } from "@/components/ai-orc/sandbox-panel";
import { CONCURRENCY_TIER_PRESETS } from "@/types/worker";
import { DEFAULT_SITE_CAP, MAX_FANOUT_WIDTH, PER_SITE_CAPS } from "@/worker/src/caps";
import type { RunDeepDive, RunLane, RunListEntry, WorkerCard } from "@/lib/ai-orc/queries";

const POLL_MS = 3000;
/** A worker whose beat is older than this is presumed dead (beats are ~10s). */
const STALE_AFTER_MS = 30_000;

interface StatePayload {
  workers: WorkerCard[];
  runs: RunListEntry[];
  run: RunDeepDive | null;
  now: string;
  error?: string;
}

function metricNum(metrics: Record<string, unknown>, key: string): number | null {
  const v = metrics[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function metricStr(metrics: Record<string, unknown>, key: string): string | null {
  const v = metrics[key];
  return typeof v === "string" ? v : null;
}

function timeAgo(iso: string, nowIso: string): string {
  const ms = new Date(nowIso).getTime() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

const RUN_STATUS_TONE: Record<string, "default" | "accent" | "success"> = {
  planning: "accent",
  running: "accent",
  review: "success",
  done: "success",
  failed: "default",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  claimed: "Claimed",
  done: "Done",
  failed: "Failed",
};

/* ────────────────────────────────────────────────────────────────────────────
 * Small building blocks
 * ──────────────────────────────────────────────────────────────────────────── */

function MemoryBar({ usedMb, totalMb, label }: { usedMb: number; totalMb: number; label: string }) {
  const pct = totalMb > 0 ? Math.min(100, Math.round((usedMb / totalMb) * 100)) : 0;
  const hot = pct >= 80;
  return (
    <div>
      <div className="flex items-center justify-between text-caption text-smoke">
        <span>{label}</span>
        <span className="font-mono">
          {formatNumber(usedMb)} / {formatNumber(totalMb)} MB · {pct}%
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-charcoal">
        <div
          className={`h-full rounded-full ${hot ? "bg-smark-orange" : "bg-phosphor-green"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  return (
    <details className="group rounded-xl border border-charcoal bg-surface-well">
      <summary className="cursor-pointer select-none px-4 py-3 text-[13px] text-silver-mist transition-colors hover:text-snow">
        {title}
        <span className="ml-2 text-caption text-graphite">({formatNumber(text.length)} chars)</span>
      </summary>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-charcoal px-4 py-3 font-mono text-[12px] leading-relaxed text-smoke">
        {text}
      </pre>
    </details>
  );
}

function WorkerPanel({ worker, nowIso }: { worker: WorkerCard; nowIso: string }) {
  const m = worker.metrics;
  const online = new Date(nowIso).getTime() - new Date(worker.lastSeenAt).getTime() < STALE_AFTER_MS;
  const sysTotal = metricNum(m, "sysTotalMb") ?? 0;
  const sysFree = metricNum(m, "sysFreeMb") ?? 0;
  const rss = metricNum(m, "rssMb") ?? 0;
  const mode = metricStr(m, "mode") ?? "unknown";

  return (
    <Card padding="lg" className={online ? "" : "opacity-50"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[13px] text-snow">{worker.workerId}</div>
        <div className="flex items-center gap-2">
          <Chip tone={online ? "success" : "default"}>{online ? "online" : `stale · ${timeAgo(worker.lastSeenAt, nowIso)}`}</Chip>
          <Chip tone={mode === "live-claude" ? "accent" : "default"}>{mode}</Chip>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        <MemoryBar usedMb={rss} totalMb={sysTotal} label="Worker process RSS vs machine RAM" />
        <MemoryBar usedMb={Math.max(0, sysTotal - sysFree)} totalMb={sysTotal} label="Machine RAM used (all processes)" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-caption text-smoke sm:grid-cols-4">
        <div>
          cpu <span className="font-mono text-silver-mist">{metricNum(m, "cpuPercent") ?? "—"}%</span>
        </div>
        <div>
          agents <span className="font-mono text-silver-mist">{metricNum(m, "activeItemAgents") ?? "—"}</span>
        </div>
        <div>
          runs <span className="font-mono text-silver-mist">{metricNum(m, "runsInFlight") ?? "—"}</span>
        </div>
        <div>
          done/failed{" "}
          <span className="font-mono text-silver-mist">
            {metricNum(m, "jobsDone") ?? 0}/{metricNum(m, "jobsFailed") ?? 0}
          </span>
        </div>
        <div>
          uptime <span className="font-mono text-silver-mist">{formatNumber(metricNum(m, "uptimeSec") ?? 0)}s</span>
        </div>
        <div>
          browser <span className="font-mono text-silver-mist">{metricStr(m, "browserDriver") ?? "none"}</span>
        </div>
        <div>
          live gate{" "}
          <span className="font-mono text-silver-mist">{m["liveBrowserGateOpen"] === true ? "OPEN" : "closed"}</span>
        </div>
        <div className="truncate" title={`${metricStr(m, "modelMaster") ?? ""} / ${metricStr(m, "modelItem") ?? ""}`}>
          models <span className="font-mono text-silver-mist">{(metricStr(m, "modelMaster") ?? "—").replace("claude-", "")}</span>
        </div>
      </div>
    </Card>
  );
}

function CapacityCard() {
  return (
    <Card padding="lg">
      <div className="text-[15px] font-medium text-snow">Capacity math — why 99 parallel agents can’t happen</div>
      <div className="mt-2 grid gap-3 text-caption text-smoke sm:grid-cols-3">
        <div>
          <div className="text-silver-mist">Concurrent item agents (per run)</div>
          {Object.entries(CONCURRENCY_TIER_PRESETS).map(([tier, cfg]) => (
            <div key={tier} className="font-mono">
              {tier}: {cfg.fanoutWidth} wide · depth {cfg.depthPerItem}
            </div>
          ))}
          <div className="mt-1">
            Absolute ceiling <span className="font-mono text-silver-mist">{MAX_FANOUT_WIDTH}</span> — queued lines wait.
          </div>
        </div>
        <div>
          <div className="text-silver-mist">Per-site request caps (hard)</div>
          {Object.entries(PER_SITE_CAPS).map(([site, cap]) => (
            <div key={site} className="font-mono">
              {site}: {cap}
            </div>
          ))}
          <div className="font-mono">any other site: {DEFAULT_SITE_CAP}</div>
        </div>
        <div>
          <div className="text-silver-mist">Browsers</div>
          <p>
            Zero browser processes unless <span className="font-mono">BROWSER_DRIVER</span> is set AND{" "}
            <span className="font-mono">ALLOW_LIVE_BROWSER=1</span> — REST/mock clients otherwise. On a 2 GB box run the{" "}
            <span className="font-mono">economy</span> tier (2 agents wide) and keep the browser gate closed.
          </p>
        </div>
      </div>
    </Card>
  );
}

function LaneCard({ lane }: { lane: RunLane }) {
  const status = lane.skip ? "Skipped" : (JOB_STATUS_LABEL[lane.jobStatus ?? ""] ?? lane.jobStatus ?? "—");
  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[13px] text-snow">{lane.line.refDesignators ?? `Line ${lane.line.lineNo ?? "?"}`}</span>
          <span className="ml-2 text-[13px] text-smoke">
            {lane.line.value ?? "—"} · {lane.line.mpn ?? "no MPN"} · need {lane.line.qty}
          </span>
          {lane.line.dnp && <Chip tone="accent">DNP</Chip>}
        </div>
        <div className="flex items-center gap-2">
          {lane.attempts !== null && lane.attempts > 1 && <Chip tone="accent" mono>{`attempt ${lane.attempts}`}</Chip>}
          <Chip tone={status === "Done" ? "success" : status === "Failed" ? "accent" : "default"}>{status}</Chip>
        </div>
      </div>

      {lane.skip ? (
        <p className="mt-2 text-caption text-smoke">
          Planner skip: {lane.skip.reason}
          {lane.skip.ruleHit ? ` · rule: ${lane.skip.ruleHit.ruleSummary}` : ""}
        </p>
      ) : (
        lane.plannedSearch && (
          <p className="mt-2 text-caption text-smoke">
            Planned order: <span className="font-mono text-silver-mist">{lane.plannedSearch.distributorOrder.join(" → ")}</span>
            {lane.plannedSearch.searchTerm ? (
              <>
                {" · search "}
                <span className="font-mono text-silver-mist">&ldquo;{lane.plannedSearch.searchTerm}&rdquo;</span>
              </>
            ) : null}
            {lane.plannedSearch.notes ? ` · ${lane.plannedSearch.notes}` : ""}
            {lane.plannedSearch.ruleHit ? ` · rule: ${lane.plannedSearch.ruleHit.ruleSummary}` : ""}
          </p>
        )
      )}

      {lane.candidates.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-caption">
            <thead className="text-graphite">
              <tr>
                <th className="pb-1 pr-3 font-normal">Distributor</th>
                <th className="pb-1 pr-3 font-normal">Price</th>
                <th className="pb-1 pr-3 font-normal">Stock</th>
                <th className="pb-1 pr-3 font-normal">MPN</th>
                <th className="pb-1 pr-3 font-normal">Package</th>
                <th className="pb-1 pr-3 font-normal">Status</th>
                <th className="pb-1 font-normal">Pick</th>
              </tr>
            </thead>
            <tbody className="text-smoke">
              {lane.candidates.map((c, i) => (
                <tr key={i} className="border-t border-charcoal/60">
                  <td className="py-1 pr-3 text-silver-mist">{c.distributorName}</td>
                  <td className="py-1 pr-3 font-mono">{c.price ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono">{c.stockQty ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono">{c.mpnMatch}</td>
                  <td className="py-1 pr-3">{c.packageMatch ? "✓" : "✗"}</td>
                  <td className="py-1 pr-3">{c.partStatus ?? "—"}</td>
                  <td className="py-1">{c.isRecommended ? <Chip tone="success">recommended</Chip> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lane.candidates.some((c) => c.why) && (
        <p className="mt-2 text-caption text-smoke">
          AI · why: <span className="text-silver-mist">{lane.candidates.find((c) => c.isRecommended)?.why ?? lane.candidates.find((c) => c.why)?.why}</span>
        </p>
      )}

      {lane.itemUserPrompt && (
        <div className="mt-3">
          <PromptBlock title="Item agent input (exact Sonnet user message)" text={lane.itemUserPrompt} />
        </div>
      )}
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Page shell
 * ──────────────────────────────────────────────────────────────────────────── */

export function Observatory() {
  const [data, setData] = useState<StatePayload | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recreated when the selection changes — the interval then polls the new run.
  const poll = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const qs = selectedRunId ? `?run=${selectedRunId}` : "";
      const res = await fetch(`/api/ai-orc/state${qs}`, { cache: "no-store" });
      const body = (await res.json()) as StatePayload;
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setError(null);
      setData(body);
      // Default-select the newest run so the page is useful on first load.
      if (!selectedRunId && body.runs.length > 0) setSelectedRunId(body.runs[0]!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [selectedRunId]);

  useEffect(() => {
    // First fetch deferred a tick (not synchronously in the effect body), then steady polling.
    const first = setTimeout(() => void poll(), 0);
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [poll]);

  const run = data?.run && data.run.id === selectedRunId ? data.run : null;
  const nowIso = data?.now ?? new Date().toISOString();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-snow">AI orchestration</h1>
          <p className="mt-0.5 text-caption text-smoke">
            Live view of runs, agents and worker machines — everything below is the pseudonymized payload the models
            actually receive (PROJ-xx / CLIENT-x by design). Refreshes every {POLL_MS / 1000}s.
          </p>
        </div>
        {error && <Chip tone="accent">{error}</Chip>}
      </div>

      {/* Sandbox — upload + limited test run */}
      <SandboxPanel onRunStarted={setSelectedRunId} />

      {/* Worker fleet */}
      <section className="flex flex-col gap-3">
        <div className="text-caption font-medium uppercase tracking-wide text-graphite">Workers</div>
        {(data?.workers ?? []).length === 0 ? (
          <Card padding="lg">
            <p className="text-[13px] text-smoke">
              No worker heartbeats yet — start one with{" "}
              <span className="font-mono text-silver-mist">cd worker; bun run start</span> (cloud env loaded). It
              reports RAM/CPU every ~10s once running.
            </p>
          </Card>
        ) : (
          (data?.workers ?? []).map((w) => <WorkerPanel key={w.workerId} worker={w} nowIso={nowIso} />)
        )}
        <CapacityCard />
      </section>

      {/* Runs */}
      <section className="flex flex-col gap-3">
        <div className="text-caption font-medium uppercase tracking-wide text-graphite">Runs</div>
        {(data?.runs ?? []).length === 0 ? (
          <Card padding="lg">
            <p className="text-[13px] text-smoke">No runs yet — start one from a BOM’s “Set up ordering →”.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {(data?.runs ?? []).map((r) => {
              const done = (r.jobCounts["done"] ?? 0) + (r.jobCounts["failed"] ?? 0);
              const total = Object.values(r.jobCounts).reduce((a, b) => a + b, 0);
              const selected = r.id === selectedRunId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRunId(r.id)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    selected ? "border-smark-orange bg-surface-well" : "border-charcoal bg-surface hover:border-slate"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-[13px] text-snow">
                      {r.bomName ?? r.id.slice(0, 8)}
                      <span className="ml-2 text-smoke">{r.projectName ?? ""}</span>
                    </div>
                    <div className="flex items-center gap-2 text-caption">
                      <span className="font-mono text-smoke">
                        {done}/{total} jobs
                      </span>
                      <span className="font-mono text-smoke">
                        {r.actualCost !== null ? `${formatINR(r.actualCost)} spent` : `${formatINR(r.estCost ?? 0)} est`}
                      </span>
                      <Chip tone={RUN_STATUS_TONE[r.status] ?? "default"}>{r.status}</Chip>
                    </div>
                  </div>
                  <div className="mt-1 text-caption text-graphite">
                    {timeAgo(r.createdAt, nowIso)} · tier {r.tier}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Deep dive */}
      {run && (
        <section className="flex flex-col gap-3">
          <div className="text-caption font-medium uppercase tracking-wide text-graphite">
            Run {run.id.slice(0, 8)} — what the AI sees
          </div>

          <Card padding="lg">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={RUN_STATUS_TONE[run.status] ?? "default"}>{run.status}</Chip>
              {run.lineLimit !== null && <Chip tone="accent" mono>{`test · first ${run.lineLimit} lines`}</Chip>}
              <Chip mono>tier {run.tier}</Chip>
              <Chip mono>{run.fanoutWidth} wide</Chip>
              <Chip mono>depth {run.depthPerItem}</Chip>
              <Chip mono>{formatINR(run.estCost ?? 0)} est</Chip>
              <Chip mono>{run.actualCost !== null ? `${formatINR(run.actualCost)} spent` : "₹0 spent"}</Chip>
              {run.rupeeCeiling !== null && <Chip mono>ceiling {formatINR(run.rupeeCeiling)}</Chip>}
            </div>
            {run.narration && <p className="mt-2 text-[13px] text-silver-mist">{run.narration}</p>}
            <p className="mt-1 text-caption text-smoke">
              Distributor sequence:{" "}
              <span className="font-mono">
                {run.distributorSequence.filter((d) => d.enabled).map((d) => d.name).join(" → ") || "—"}
              </span>
              {run.inStockLines.length > 0 &&
                ` · ${run.inStockLines.length} line(s) already in stock (planner context only)`}
            </p>
          </Card>

          <div className="flex flex-col gap-2">
            <PromptBlock title="Master planner — system prompt (Opus)" text={run.masterSystemPrompt} />
            {run.masterUserPrompt && (
              <PromptBlock title="Master planner — exact user message (the full run payload)" text={run.masterUserPrompt} />
            )}
            <PromptBlock title="Item agent — system prompt (Sonnet, one call per line)" text={run.itemSystemPrompt} />
            {run.rulesDigest && <PromptBlock title="Active rules digest (injected into both)" text={run.rulesDigest} />}
          </div>

          <div className="text-caption text-graphite">
            {formatNumber(run.lanes.length)} lanes — each line’s plan, results and exact agent input:
          </div>
          <div className="flex flex-col gap-2">
            {run.lanes.map((lane) => (
              <LaneCard key={lane.bomLineId} lane={lane} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
