"use client";

/**
 * components/ai-orc/sandbox-panel.tsx — the /ai_orc "test bench": upload a
 * BOM (or pick a recent one) and fire a LIMITED run — first N to-order lines
 * only (default 5) — so pipeline speed and accuracy can be judged cheaply
 * before committing to a full 100-line run. Uses the same production
 * upload/enqueue paths; the only difference is `lineLimit`
 * (app/(app)/ai_orc/actions.ts).
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  getSandboxOptionsAction,
  sandboxStartRunAction,
  sandboxUploadBomAction,
  type SandboxOptions,
} from "@/app/(app)/ai_orc/actions";

type Mode = "existing" | "upload";
type Tier = "economy" | "balanced" | "thorough";

const SELECT_CLASSES =
  "h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none transition-colors focus:border-smark-orange";

export function SandboxPanel({ onRunStarted }: { onRunStarted: (runId: string) => void }) {
  const [options, setOptions] = useState<SandboxOptions | null>(null);
  const [mode, setMode] = useState<Mode>("existing");
  const [bomId, setBomId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [bomName, setBomName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [lineLimit, setLineLimit] = useState("5");
  const [tier, setTier] = useState<Tier>("economy");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadOptions = useCallback(async () => {
    try {
      const opts = await getSandboxOptionsAction();
      setOptions(opts);
      setBomId((current) => current || (opts.boms[0]?.id ?? ""));
      setProjectId((current) => current || (opts.projects[0]?.id ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sandbox options.");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick (same pattern as observatory.tsx) — the synchronous-setState-in-effect lint rule.
    const t = setTimeout(() => void loadOptions(), 0);
    return () => clearTimeout(t);
  }, [loadOptions]);

  function upload() {
    setError(null);
    setNotice(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) return setError("Choose a .xlsx file to upload.");
    if (!projectId) return setError("Pick a project to upload into.");
    if (!bomName.trim()) return setError("Name the test BOM.");

    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("name", bomName.trim());
    formData.set("file", file);

    startTransition(async () => {
      const result = await sandboxUploadBomAction(formData);
      if (!result.ok) return setError(result.error);
      setNotice(`Uploaded “${bomName.trim()}” — ready to run.`);
      setBomId(result.bomId);
      setMode("existing");
      setBomName("");
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadOptions();
      setBomId(result.bomId); // keep the fresh upload selected after the list refresh
    });
  }

  function startRun() {
    setError(null);
    setNotice(null);
    if (!bomId) return setError("Pick a BOM first.");
    const limit = Number(lineLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return setError("Line limit must be a whole number between 1 and 50.");
    }

    startTransition(async () => {
      const result = await sandboxStartRunAction({ bomId, tier, lineLimit: limit });
      if (!result.ok) return setError(result.error);
      setNotice(`Test run started — first ${limit} line(s) only. Watch it below.`);
      onRunStarted(result.runId);
    });
  }

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Sandbox — test a run on a few lines first</SectionLabel>
          <SegmentedControl
            aria-label="BOM source"
            options={[
              { value: "existing", label: "Existing BOM" },
              { value: "upload", label: "Upload new" },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
              setNotice(null);
            }}
          />
        </div>

        {mode === "upload" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project">
              <select className={SELECT_CLASSES} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {(options?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="BOM name">
              <Input value={bomName} onChange={(e) => setBomName(e.target.value)} placeholder="AI test — GCU v1.1" />
            </Field>
            <div
              className="cursor-pointer rounded-xl border-[1.5px] border-dashed border-slate bg-surface-panel px-4 py-5 text-center transition-colors hover:border-smark-orange sm:col-span-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              />
              <div className="text-[14px] text-snow">{fileName ?? "Choose the .xlsx to test with"}</div>
            </div>
            <div className="sm:col-span-2">
              <Button onClick={upload} loading={isPending}>
                Upload BOM
              </Button>
            </div>
          </div>
        ) : (
          <Field label="BOM" hint="Newest first — upload one with the toggle above if it isn't here yet.">
            <select className={SELECT_CLASSES} value={bomId} onChange={(e) => setBomId(e.target.value)}>
              {(options?.boms ?? []).length === 0 && <option value="">No BOMs yet</option>}
              {(options?.boms ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.projectName} (×{b.buildQty})
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <Field label="Lines to test" hint="Only the first N to-order lines get agents." className="w-32">
            <Input
              mono
              inputMode="numeric"
              value={lineLimit}
              onChange={(e) => setLineLimit(e.target.value)}
              placeholder="5"
            />
          </Field>
          <Field label="Tier">
            <SegmentedControl
              aria-label="Tier"
              variant="accent"
              options={[
                { value: "economy", label: "economy" },
                { value: "balanced", label: "balanced" },
                { value: "thorough", label: "thorough" },
              ]}
              value={tier}
              onChange={setTier}
            />
          </Field>
          <Button onClick={startRun} loading={isPending} disabled={mode === "upload"}>
            Start test run →
          </Button>
        </div>

        {error && <div className="text-caption text-smark-orange-soft">{error}</div>}
        {notice && <div className="text-caption text-phosphor-green">{notice}</div>}
      </div>
    </Card>
  );
}
