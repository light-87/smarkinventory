"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { setPartFieldTemplateActiveAction } from "@/lib/settings/actions";
import type { PartFieldTemplateItem } from "@/lib/settings/types";

/**
 * Retire remembered custom part fields [R2-23] (plan/tab-settings.md §2).
 * `active` is the ONLY thing this card touches — Receive already filters
 * `smark_part_field_templates` by `active = true` (lib/receive/queries.ts
 * `getActiveCustomFieldTemplates`), so flipping it here is enough to stop a
 * field auto-rendering on the New-part form, no receive-owned code changes.
 */
export function PartFieldTemplatesCard({ templates }: { templates: PartFieldTemplateItem[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function toggle(item: PartFieldTemplateItem) {
    setTogglingId(item.id);
    startTransition(async () => {
      const result = await setPartFieldTemplateActiveAction(item.id, !item.active);
      setTogglingId(null);
      if (result.ok) router.refresh();
      else push({ msg: result.error });
    });
  }

  return (
    <Card padding="none">
      <CardHeader
        title="Remembered custom part fields"
        meta={<span className="text-smoke">from Receive&apos;s &quot;+ add custom field&quot;</span>}
      />
      <CardBody>
        {templates.length === 0 ? (
          <p className="text-body-sm text-smoke">
            No custom fields remembered yet — they appear here after someone adds one from Receive&apos;s New-part form.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {templates.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border border-charcoal px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[14px] text-snow">{item.label}</span>
                <Chip tone="neutral" size="sm">
                  {item.field_type}
                </Chip>
                <Chip tone={item.active ? "success" : "default"} size="sm">
                  {item.active ? "Active" : "Retired"}
                </Chip>
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => toggle(item)}>
                  {togglingId === item.id ? "…" : item.active ? "Retire" : "Restore"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
