"use client";

import { SectionLabel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EngineerOption } from "@/lib/pm/queries";

export interface EngineerHoursMatrixProps {
  engineers: readonly EngineerOption[];
  /** userId → estimated-hours string. Presence of a key = engineer is assigned. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  label?: string;
}

/**
 * Per-engineer "assign + estimated hours" checkbox matrix, shared by the
 * new-task form and the change-request accept form (previously duplicated in
 * both). Controlled — the parent owns the `hoursByUser` map.
 */
export function EngineerHoursMatrix({ engineers, value, onChange, label = "Assign engineers" }: EngineerHoursMatrixProps) {
  if (engineers.length === 0) return null;

  function toggle(userId: string, checked: boolean) {
    const next = { ...value };
    if (checked) next[userId] = next[userId] ?? "1";
    else delete next[userId];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <SectionLabel>{label}</SectionLabel>
        <p className="mt-1 text-caption text-faint">Estimated hours drive the efficiency score — set a realistic number per engineer.</p>
      </div>
      {engineers.map((eng) => {
        const checked = eng.id in value;
        const name = eng.displayName ?? eng.username;
        return (
          <div key={eng.id} className="flex items-center gap-3">
            <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 text-[15px] text-snow select-none">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggle(eng.id, e.target.checked)}
                className="size-[18px] flex-none accent-smark-orange"
              />
              {name}
            </label>
            {checked && (
              <Input
                uiSize="sm"
                type="number"
                min="0.5"
                step="0.5"
                value={value[eng.id]}
                onChange={(e) => onChange({ ...value, [eng.id]: e.target.value })}
                className="w-24"
                aria-label={`Estimated hours for ${name}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
