"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { MODULES, type InventoryAccess, type Module } from "@/lib/rbac/types";
import { grantModuleAction, revokeModuleAction, setInventoryAccessAction } from "@/lib/rbac/actions";

const MODULE_LABELS: Record<Module, string> = {
  inventory: "Inventory",
  project_management: "Project management",
  attendance: "Attendance",
};

export interface EmployeeOption {
  id: string;
  username: string;
  displayName: string | null;
}

/**
 * Settings → Users module-grant grid (0013): one card per active employee,
 * toggle checkboxes (Inventory / Project management / Attendance) that call
 * grant/revokeModuleAction. (0017) When Inventory is granted, a View/Edit
 * segmented control sets that grant's access level — view-only employees can
 * see stock but not change it (enforced at RLS via smark_can_edit_inventory).
 * Optimistic local state, rolled back on error. Owner-only.
 */
export function ModuleGrantsGrid({
  employees,
  initialGrants,
  initialAccess,
}: {
  employees: EmployeeOption[];
  initialGrants: Record<string, Module[]>;
  initialAccess: Record<string, InventoryAccess>;
}) {
  const [grants, setGrants] = useState(initialGrants);
  const [access, setAccess] = useState(initialAccess);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (employees.length === 0) {
    return (
      <Card>
        <CardBody className="p-0 text-body-sm text-smoke">No active employees yet.</CardBody>
      </Card>
    );
  }

  function toggle(userId: string, module: Module, checked: boolean) {
    setError(null);
    const key = `${userId}:${module}`;
    setPendingKey(key);
    startTransition(async () => {
      const result = checked ? await grantModuleAction({ userId, module }) : await revokeModuleAction({ userId, module });
      if (!result.ok) {
        setError(result.error);
        setPendingKey(null);
        return;
      }
      setGrants((prev) => {
        const current = prev[userId] ?? [];
        const next = checked ? Array.from(new Set([...current, module])) : current.filter((m) => m !== module);
        return { ...prev, [userId]: next };
      });
      // A fresh inventory grant defaults to 'edit' (DB default) — mirror that locally.
      if (module === "inventory" && checked) {
        setAccess((prev) => ({ ...prev, [userId]: prev[userId] ?? "edit" }));
      }
      setPendingKey(null);
    });
  }

  function setInventoryLevel(userId: string, level: InventoryAccess) {
    setError(null);
    const key = `${userId}:inventory:access`;
    setPendingKey(key);
    startTransition(async () => {
      const result = await setInventoryAccessAction({ userId, access: level });
      if (!result.ok) {
        setError(result.error);
        setPendingKey(null);
        return;
      }
      setAccess((prev) => ({ ...prev, [userId]: level }));
      setPendingKey(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-smark-orange-soft bg-surface-danger px-3.5 py-2.5 text-[14px] text-smark-orange-soft">
          {error}
        </div>
      )}
      {employees.map((employee) => {
        const employeeGrants = grants[employee.id] ?? [];
        const inventoryOn = employeeGrants.includes("inventory");
        const level = access[employee.id] ?? "edit";
        const accessBusy = pendingKey === `${employee.id}:inventory:access`;
        return (
          <Card key={employee.id} padding="none">
            <CardHeader
              title={employee.displayName || employee.username}
              meta={<span className="text-smoke">@{employee.username}</span>}
            />
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                {MODULES.map((module) => {
                  const key = `${employee.id}:${module}`;
                  const checked = employeeGrants.includes(module);
                  const busy = pendingKey === key;
                  return (
                    <label
                      key={module}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border border-charcoal px-4 py-2 text-[14px] text-snow has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) => toggle(employee.id, module, e.target.checked)}
                        className="size-[18px] accent-smark-orange"
                      />
                      {MODULE_LABELS[module]}
                    </label>
                  );
                })}
              </div>

              {inventoryOn && (
                <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border-faint bg-surface-panel px-3.5 py-2.5">
                  <span className="text-caption text-smoke">Inventory access</span>
                  <div className="inline-flex overflow-hidden rounded-full border border-charcoal">
                    {(["view", "edit"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        disabled={accessBusy}
                        onClick={() => setInventoryLevel(employee.id, lvl)}
                        className={cn(
                          "min-h-9 px-4 text-[13px] transition-colors disabled:opacity-50",
                          level === lvl
                            ? lvl === "edit"
                              ? "bg-phosphor-green text-white"
                              : "bg-warn text-white"
                            : "text-smoke hover:bg-surface-raised",
                        )}
                      >
                        {lvl === "view" ? "View only" : "Can edit"}
                      </button>
                    ))}
                  </div>
                  <span className="text-caption text-smoke">
                    {level === "edit" ? "Can change stock." : "Read-only — can see stock but not change it."}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
