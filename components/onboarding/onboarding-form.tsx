"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { completeOnboardingAndRedirectAction } from "@/lib/onboarding/actions";

interface DraftState {
  birth_date: string;
  date_of_joining: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string;
}

const EMPTY_DRAFT: DraftState = {
  birth_date: "",
  date_of_joining: "",
  bank_account_name: "",
  bank_account_number: "",
  bank_ifsc: "",
  bank_name: "",
};

/**
 * First-login onboarding form (plain controlled state + Server Action —
 * same call as components/expenses/entry-form-drawer.tsx: the Server
 * Action's zod schema, lib/onboarding/helpers.ts, is the real validation
 * boundary, this is just a light pre-submit check). Bank/IFSC values are
 * never logged — only ever read into local state and handed to the action.
 */
export function OnboardingForm() {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (!draft.birth_date) return push({ msg: "Date of birth is required" });
    if (!draft.date_of_joining) return push({ msg: "Date of joining is required" });
    if (!draft.bank_account_name.trim()) return push({ msg: "Account holder name is required" });
    if (!draft.bank_account_number.trim()) return push({ msg: "Account number is required" });
    if (!draft.bank_ifsc.trim()) return push({ msg: "IFSC code is required" });
    if (!draft.bank_name.trim()) return push({ msg: "Bank name is required" });

    startTransition(async () => {
      const result = await completeOnboardingAndRedirectAction({
        birth_date: draft.birth_date,
        date_of_joining: draft.date_of_joining,
        bank_account_name: draft.bank_account_name.trim(),
        bank_account_number: draft.bank_account_number.trim(),
        bank_ifsc: draft.bank_ifsc.trim().toUpperCase(),
        bank_name: draft.bank_name.trim(),
      });
      // A successful submit redirects server-side and never resolves here;
      // only a failure ever reaches this branch.
      if (result && !result.ok) push({ msg: result.error ?? "Could not save your details." });
    });
  }

  return (
    <Card padding="lg">
      <CardBody className="flex flex-col gap-5 p-0">
        <div>
          <SectionLabel className="mb-2">Personal details</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor="onb-dob" label={<>Date of birth <span className="text-smark-orange">*</span></>}>
              <Input id="onb-dob" type="date" mono value={draft.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
            </Field>
            <Field htmlFor="onb-doj" label={<>Date of joining <span className="text-smark-orange">*</span></>}>
              <Input id="onb-doj" type="date" mono value={draft.date_of_joining} onChange={(e) => set("date_of_joining", e.target.value)} />
            </Field>
          </div>
        </div>

        <div>
          <SectionLabel className="mb-2">Bank details (for payroll)</SectionLabel>
          <div className="flex flex-col gap-3">
            <Field htmlFor="onb-bank-name" label={<>Account holder name <span className="text-smark-orange">*</span></>}>
              <Input
                id="onb-bank-name"
                value={draft.bank_account_name}
                onChange={(e) => set("bank_account_name", e.target.value)}
                placeholder="As per bank records"
                autoComplete="off"
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field htmlFor="onb-acc-no" label={<>Account number <span className="text-smark-orange">*</span></>}>
                <Input
                  id="onb-acc-no"
                  mono
                  inputMode="numeric"
                  value={draft.bank_account_number}
                  onChange={(e) => set("bank_account_number", e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field htmlFor="onb-ifsc" label={<>IFSC code <span className="text-smark-orange">*</span></>}>
                <Input
                  id="onb-ifsc"
                  mono
                  value={draft.bank_ifsc}
                  onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())}
                  placeholder="HDFC0001234"
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field htmlFor="onb-bank" label={<>Bank name <span className="text-smark-orange">*</span></>}>
              <Input id="onb-bank" value={draft.bank_name} onChange={(e) => set("bank_name", e.target.value)} placeholder="HDFC Bank" />
            </Field>
          </div>
        </div>

        <Button size="lg" fullWidth loading={isPending} onClick={submit}>
          Continue
        </Button>
      </CardBody>
    </Card>
  );
}
