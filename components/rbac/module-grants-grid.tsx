"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MODULES, type Module } from "@/lib/rbac/types";
import { grantModuleAction, revokeModuleAction } from "@/lib/rbac/actions";

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
 * Settings → Users module-grant grid (migration 0013): one card per active
 * employee, 3 toggle checkboxes (Inventory / Project management /
 * Attendance) that call grant/revokeModuleAction directly — optimistic local
 * state, rolled back on error. Owner-only (the page above already gates
 * this); RLS on `smark_user_module_grants` is the real enforcement if this
 * component were somehow reached without the page guard.
 */
export function ModuleGrantsGrid({
  employees,
  initialGrants,
}: {
  employees: EmployeeOption[];
  initialGrants: Record<string, Module[]>;
}) {
  const [grants, setGrants] = useState(initialGrants);
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
      setPendingKey(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-smark-orange-soft bg-smark-orange-soft/10 px-3.5 py-2.5 text-[14px] text-smark-orange-soft">{error}</div>
      )}
      {employees.map((employee) => {
        const employeeGrants = grants[employee.id] ?? [];
        return (
          <Card key={employee.id} padding="none">
            <CardHeader
              title={employee.displayName || employee.username}
              meta={<span className="text-smoke">@{employee.username}</span>}
            />
            <CardBody className="flex flex-wrap gap-3">
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
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
