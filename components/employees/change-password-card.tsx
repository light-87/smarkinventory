"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { changeOwnPasswordAction } from "@/lib/employees/actions";

/**
 * Settings → My Profile: change your own password. Calls
 * `changeOwnPasswordAction` (Supabase `auth.updateUser` on the caller's own
 * session — no service role). The values live only in local state and the
 * request; never logged.
 */
export function ChangePasswordCard() {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit() {
    if (password.length < 8) {
      push({ msg: "Password must be at least 8 characters." });
      return;
    }
    if (password !== confirm) {
      push({ msg: "The two passwords don't match." });
      return;
    }
    startTransition(async () => {
      const result = await changeOwnPasswordAction({ password });
      if (result.ok) {
        push({ msg: "Password changed" });
        setPassword("");
        setConfirm("");
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="Change password" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field htmlFor="new-password" label="New password">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </Field>
          <Field htmlFor="confirm-password" label="Confirm password">
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </div>
        <div>
          <Button variant="accent" loading={isPending} onClick={submit}>
            Update password
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
