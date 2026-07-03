"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createDistributorAction, setDistributorActiveAction } from "@/lib/settings/actions";
import { ADDABLE_DISTRIBUTOR_METHODS, DISTRIBUTOR_METHOD_LABELS, type DistributorItem, type DistributorMethod } from "@/lib/settings/types";
import { NativeSelect } from "./native-select";

interface FormState {
  name: string;
  method: DistributorMethod;
  baseUrl: string;
}

const EMPTY_FORM: FormState = { name: "", method: "rest", baseUrl: "" };

/** `null` for browse-method rows — the method chip alone already says "no key needed". */
function keyStateChip(item: DistributorItem) {
  if (item.keyState === "not_applicable") return null;
  if (item.keyState === "configured") return <Chip tone="success">Key configured</Chip>;
  return <Chip tone="accent">Key needed</Chip>;
}

/**
 * Distributors card (plan/tab-settings.md R2-28 — "addable"). Real writes:
 * `smark_distributors` (name/URL/method/active) + a
 * `smark_distributor_preferences` row seeded `enabled: false` so a new site
 * starts OFF in every BOM's sequence editor (bom-pipeline, not built yet —
 * this is the exact mechanism its default-OFF requirement reads from).
 *
 * "Masked key state" for the baseline five is a best-effort env-presence
 * check (lib/settings/queries.ts `keyStateFor`) — `smark_distributors` has
 * no column recording WHICH env var a given row's key lives in (see this
 * package's notes-for-integrator); a freshly-added REST-with-key site always
 * reads "Key needed" until that column exists and the integrator wires it up.
 * The secret itself is NEVER entered here — only env var names are ever shown.
 */
export function DistributorsCard({ distributors }: { distributors: DistributorItem[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function submit() {
    if (!form.name.trim()) return push({ msg: "Name is required" });
    startTransition(async () => {
      const result = await createDistributorAction({
        name: form.name.trim(),
        method: form.method,
        baseUrl: form.baseUrl.trim() || null,
      });
      if (result.ok) {
        push({ msg: `${form.name.trim()} added — starts OFF in BOM sequence editors until turned on` });
        setForm(EMPTY_FORM);
        setAdding(false);
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function toggleActive(item: DistributorItem) {
    setTogglingId(item.row.id);
    startTransition(async () => {
      const result = await setDistributorActiveAction(item.row.id, !item.row.active);
      setTogglingId(null);
      if (result.ok) router.refresh();
      else push({ msg: result.error });
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="Distributors & API keys" />
      <CardBody>
        <div className="flex flex-col gap-2">
          {distributors.map((item) => (
            <div
              key={item.row.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-charcoal px-3.5 py-2.5"
            >
              <span className="w-[110px] flex-none truncate font-mono text-[13px] text-snow">{item.row.name}</span>
              <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-smoke sm:block">
                {item.row.base_url ?? "no URL on file"}
              </span>
              <Chip tone="default">{DISTRIBUTOR_METHOD_LABELS[item.row.api_type]}</Chip>
              {keyStateChip(item)}
              <Button
                size="sm"
                variant={item.row.active ? "outline" : "ghost"}
                disabled={isPending}
                onClick={() => toggleActive(item)}
              >
                {togglingId === item.row.id ? "…" : item.row.active ? "Active" : "Inactive"}
              </Button>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-charcoal p-3">
            <Field label="Name" htmlFor="dist-name" className="min-w-[140px] flex-1">
              <Input
                id="dist-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Octopart"
              />
            </Field>
            <Field label="Site URL" htmlFor="dist-url" className="min-w-[160px] flex-1">
              <Input
                id="dist-url"
                value={form.baseUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://octopart.com"
              />
            </Field>
            <Field label="Method" htmlFor="dist-method" className="w-44">
              <NativeSelect
                id="dist-method"
                value={form.method}
                onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value as DistributorMethod }))}
                options={ADDABLE_DISTRIBUTOR_METHODS}
              />
            </Field>
            <Button onClick={submit} loading={isPending}>
              Add
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
            {form.method === "rest" && (
              <p className="w-full text-caption text-faint">
                REST-with-key sites need their key added to the server&apos;s env vars by whoever manages deploys — the
                key itself is never entered here, only the name/URL/method.
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 w-fit cursor-pointer text-[13px] text-smoke transition-colors hover:text-snow"
          >
            + Add distributor
          </button>
        )}
      </CardBody>
    </Card>
  );
}
