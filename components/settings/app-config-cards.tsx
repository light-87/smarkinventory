"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { updateAppConfigAction } from "@/lib/settings/actions";
import { LABEL_SIZE_OPTIONS, type AppConfig, type LabelSize } from "@/lib/settings/types";
import type { ConcurrencyPreset } from "@/types/db";
import { CONCURRENCY_TIER_PRESETS } from "@/types/worker";
import { NativeSelect } from "./native-select";

const CONCURRENCY_OPTIONS: { value: ConcurrencyPreset; label: string }[] = (
  Object.keys(CONCURRENCY_TIER_PRESETS) as ConcurrencyPreset[]
).map((preset) => ({
  value: preset,
  label: `${preset[0]!.toUpperCase()}${preset.slice(1)}`,
}));

/**
 * Small config cards (plan/tab-settings.md §2): Label size, Low-stock mode,
 * Concurrency default. Backed by `lib/settings/app-config.ts` — a local-disk
 * seam, not a real DB table yet (see that file's header + this package's
 * notes-for-integrator). Fully interactive; each save round-trips through
 * `updateAppConfigAction` so the moment a real table lands, these start
 * persisting across restarts with zero UI changes.
 */
export function AppConfigCards({ config }: { config: AppConfig }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  const [labelSize, setLabelSize] = useState<LabelSize>(config.labelSize);
  const [threshold, setThreshold] = useState<string>(
    config.lowStockDefaultThreshold == null ? "" : String(config.lowStockDefaultThreshold),
  );
  const [concurrency, setConcurrency] = useState<ConcurrencyPreset>(config.concurrencyDefault);

  function save(patch: Partial<AppConfig>, successMsg: string) {
    startTransition(async () => {
      const result = await updateAppConfigAction(patch);
      if (result.ok) {
        push({ msg: successMsg });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card padding="none">
        <CardHeader title="Label size" />
        <CardBody className="flex flex-col gap-3">
          <NativeSelect
            value={labelSize}
            onChange={(e) => setLabelSize(e.target.value as LabelSize)}
            options={LABEL_SIZE_OPTIONS}
          />
          <p className="text-caption text-faint">Drives the Avery batch-print PDF (Receive&apos;s label queue).</p>
          <Button
            size="sm"
            variant="outline"
            disabled={labelSize === config.labelSize}
            loading={isPending}
            onClick={() => save({ labelSize }, "Label size saved")}
          >
            Save
          </Button>
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader title="Low-stock mode" />
        <CardBody className="flex flex-col gap-3">
          <p className="text-caption text-faint">
            Low-stock is always per-part (<code className="font-mono text-silver-mist">reorder_point</code>) — Dashboard,
            Inventory and Shelves all read the same rule: qty ≤ threshold is low, qty = 0 is out.
          </p>
          <Field label="Default threshold for new parts" htmlFor="low-stock-default">
            <Input
              id="low-stock-default"
              type="number"
              min={0}
              inputMode="numeric"
              mono
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="none"
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            loading={isPending}
            disabled={threshold === (config.lowStockDefaultThreshold == null ? "" : String(config.lowStockDefaultThreshold))}
            onClick={() =>
              save(
                { lowStockDefaultThreshold: threshold.trim() === "" ? null : Number(threshold) },
                "Default threshold saved",
              )
            }
          >
            Save
          </Button>
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader title="Concurrency default" />
        <CardBody className="flex flex-col gap-3">
          <SegmentedControl
            aria-label="Concurrency default"
            value={concurrency}
            onChange={(value) => {
              setConcurrency(value);
              save({ concurrencyDefault: value }, "Concurrency default saved");
            }}
            options={CONCURRENCY_OPTIONS}
          />
          <p className="text-caption text-faint">
            ~{CONCURRENCY_TIER_PRESETS[concurrency].fanoutWidth} agents in parallel for new ordering workspaces — the
            fixed per-site cap always wins over this.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
