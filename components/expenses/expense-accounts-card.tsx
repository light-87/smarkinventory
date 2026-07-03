"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  createExpenseAccountAction,
  setExpenseAccountActiveAction,
  updateExpenseAccountAction,
} from "@/lib/expenses/actions";
import { ExpenseAccountTypeSchema, type ExpenseAccountType } from "@/types/db";
import type { AccountOption } from "@/lib/expenses/types";
import { NativeSelect } from "./native-select";

const ACCOUNT_TYPES = ExpenseAccountTypeSchema.options;

interface FormState {
  id: string | null;
  name: string;
  account_type: ExpenseAccountType;
}

const EMPTY_FORM: FormState = { id: null, name: "", account_type: "cash" };

/** Owner-only CRUD card for cash/bank/UPI accounts (plan/tab-expenses.md R2-28, FEATURES.md §16). */
export function ExpenseAccountsCard({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  function refresh() {
    router.refresh();
  }

  function submit() {
    if (!form.name.trim()) return push({ msg: "Name is required" });
    const input = { name: form.name.trim(), account_type: form.account_type };

    startTransition(async () => {
      const result = form.id
        ? await updateExpenseAccountAction(form.id, input)
        : await createExpenseAccountAction(input);
      if (result.ok) {
        push({ msg: form.id ? "Account updated" : "Account added" });
        setForm(EMPTY_FORM);
        setAdding(false);
        refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function toggleActive(account: AccountOption) {
    startTransition(async () => {
      const result = await setExpenseAccountActiveAction(account.id, !account.active);
      if (result.ok) refresh();
      else push({ msg: result.error });
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="Expense accounts" meta={<span className="text-smoke">cash / bank / UPI</span>} />
      <CardBody>
        <div className="flex flex-col gap-2.5">
          {accounts.length === 0 && !adding && (
            <div className="text-body-sm text-smoke">No accounts yet — add the first cash/bank/UPI account.</div>
          )}
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-3 rounded-lg border border-charcoal px-3.5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[13px] text-snow">{account.name}</span>
              <Chip tone="neutral" size="sm">
                {account.account_type.toUpperCase()}
              </Chip>
              <Chip tone={account.active ? "success" : "default"} size="sm">
                {account.active ? "Active" : "Retired"}
              </Chip>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(true);
                  setForm({ id: account.id, name: account.name, account_type: account.account_type });
                }}
              >
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(account)} disabled={isPending}>
                {account.active ? "Retire" : "Restore"}
              </Button>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-charcoal p-3">
            <Field label="Name" htmlFor="expense-account-name" className="min-w-[160px] flex-1">
              <Input
                id="expense-account-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="HDFC current"
              />
            </Field>
            <Field label="Type" htmlFor="expense-account-type" className="w-32">
              <NativeSelect
                id="expense-account-type"
                value={form.account_type}
                onChange={(e) => setForm((prev) => ({ ...prev, account_type: e.target.value as ExpenseAccountType }))}
                options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t.toUpperCase() }))}
              />
            </Field>
            <Button onClick={submit} loading={isPending}>
              {form.id ? "Save" : "Add"}
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
            className="mt-4 w-fit cursor-pointer text-[13px] text-smoke transition-colors hover:text-snow"
          >
            + Add account
          </button>
        )}
      </CardBody>
    </Card>
  );
}
