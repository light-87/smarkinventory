"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createEmployeeAction } from "@/lib/employees/actions";

/**
 * Settings → Users & roles: "Add employee" — the owner-facing account
 * creation flow that was never built (auth.admin.createUser previously only
 * existed in scripts/seed-dev-users.ts, a local-dev-only script). Creates the
 * auth user + smark_app_users profile row via lib/employees/actions.ts
 * createEmployeeAction, then refreshes so the new account shows up in the
 * module-grants grid below immediately.
 */
export function AddEmployeeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"employee" | "accountant">("employee");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setUsername("");
    setPassword("");
    setDisplayName("");
    setRole("employee");
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createEmployeeAction({ username, password, displayName, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        + Add employee
      </Button>
    );
  }

  return (
    <Card padding="none">
      <CardHeader title="Add employee" />
      <CardBody className="flex flex-col gap-3">
        {error && (
          <div className="rounded-lg border border-smark-orange-soft bg-smark-orange-soft/10 px-3.5 py-2.5 text-[14px] text-smark-orange-soft">{error}</div>
        )}
        <label className="flex flex-col gap-1.5 text-[14px] text-smoke">
          Username
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. priya"
            disabled={pending}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] text-smoke">
          Temporary password
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            disabled={pending}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] text-smoke">
          Display name
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Priya Sharma"
            disabled={pending}
          />
        </label>
        <div className="flex gap-2">
          {(["employee", "accountant"] as const).map((r) => (
            <label
              key={r}
              className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-charcoal px-3 py-2 text-[14px] capitalize text-snow has-[:checked]:border-smark-orange has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            >
              <input
                type="radio"
                name="role"
                className="sr-only"
                checked={role === r}
                disabled={pending}
                onChange={() => setRole(r)}
              />
              {r}
            </label>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          <Button
            onClick={submit}
            disabled={pending || !username.trim() || password.length < 8 || !displayName.trim()}
            loading={pending}
          >
            Create account
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
        <p className="text-[13px] text-faint">
          Share the username and temporary password with them directly — there&apos;s no invite email.
        </p>
      </CardBody>
    </Card>
  );
}
