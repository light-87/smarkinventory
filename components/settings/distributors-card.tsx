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

/**
 * Distributors card (plan/tab-settings.md R2-28 — "addable"). Real writes:
 * `smark_distributors` (name/URL/method/active) + a
 * `smark_distributor_preferences` row seeded `enabled: true` so a new site is
 * searched by default in every BOM's sequence editor (that per-BOM editor can
 * still turn it off for a specific BOM).
 *
 * No API keys are entered or shown here: since the ordering pivot to the
 * desktop app the sourcing agent browses every site with the user's own
 * Claude session, so there's no per-distributor key to configure.
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
        push({ msg: `${form.name.trim()} added — on by default in BOM sequence editors` });
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
      <CardHeader title="Distributors" />
      <CardBody>
        <div className="flex flex-col gap-2">
          {distributors.map((item) => (
            <div
              key={item.row.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-charcoal px-3.5 py-2.5"
            >
              <span className="w-[110px] flex-none truncate font-mono text-[15px] text-snow">{item.row.name}</span>
              <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-smoke sm:block">
                {item.row.base_url ?? "no URL on file"}
              </span>
              <Chip tone="default">{DISTRIBUTOR_METHOD_LABELS[item.row.api_type]}</Chip>
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
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 w-fit cursor-pointer text-[15px] text-smoke transition-colors hover:text-snow"
          >
            + Add distributor
          </button>
        )}
      </CardBody>
    </Card>
  );
}
