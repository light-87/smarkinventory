"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateOwnProfileAction } from "@/lib/employees/actions";
import type { OwnProfile, PrivateFields } from "@/lib/employees/types";

interface DraftState {
  birth_date: string;
  date_of_joining: string;
  email: string;
  phone: string;
  pan_number: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string;
}

function draftFromProfile(profile: OwnProfile, privateFields: PrivateFields | null): DraftState {
  return {
    birth_date: profile.birth_date ?? "",
    date_of_joining: profile.date_of_joining ?? "",
    email: privateFields?.email ?? "",
    phone: privateFields?.phone ?? "",
    pan_number: privateFields?.pan_number ?? "",
    bank_account_name: privateFields?.bank_account_name ?? "",
    bank_account_number: privateFields?.bank_account_number ?? "",
    bank_ifsc: privateFields?.bank_ifsc ?? "",
    bank_name: privateFields?.bank_name ?? "",
  };
}

/**
 * Settings → My Profile edit card. Plain controlled state + Server Action —
 * same call as components/expenses/entry-form-drawer.tsx. Bank/PAN values
 * only ever live in this component's local state and the request payload —
 * never logged (see lib/employees/actions.ts header). `privateFields` is
 * sourced from `smark_employee_private` (migration 0011), never from
 * `profile`/`smark_app_users`.
 */
export function ProfileForm({ profile, privateFields }: { profile: OwnProfile; privateFields: PrivateFields | null }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<DraftState>(() => draftFromProfile(profile, privateFields));

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    startTransition(async () => {
      const result = await updateOwnProfileAction({
        birth_date: draft.birth_date || null,
        date_of_joining: draft.date_of_joining || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        pan_number: draft.pan_number.trim() ? draft.pan_number.trim().toUpperCase() : null,
        bank_account_name: draft.bank_account_name || null,
        bank_account_number: draft.bank_account_number || null,
        bank_ifsc: draft.bank_ifsc.trim() ? draft.bank_ifsc.trim().toUpperCase() : null,
        bank_name: draft.bank_name || null,
      });
      if (result.ok) {
        push({ msg: "Profile updated" });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="My profile" meta={<span className="text-smoke">@{profile.username}</span>} />
      <CardBody className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field htmlFor="profile-dob" label="Date of birth">
            <Input id="profile-dob" type="date" mono value={draft.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
          </Field>
          <Field htmlFor="profile-doj" label="Date of joining">
            <Input id="profile-doj" type="date" mono value={draft.date_of_joining} onChange={(e) => set("date_of_joining", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field htmlFor="profile-email" label="Email">
            <Input
              id="profile-email"
              type="email"
              value={draft.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
            />
          </Field>
          <Field htmlFor="profile-phone" label="Phone">
            <Input
              id="profile-phone"
              type="tel"
              inputMode="tel"
              value={draft.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field htmlFor="profile-pan" label="PAN number">
          <Input
            id="profile-pan"
            mono
            value={draft.pan_number}
            onChange={(e) => set("pan_number", e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            autoComplete="off"
          />
        </Field>

        <div className="flex flex-col gap-3 rounded-lg border border-charcoal p-3.5">
          <span className="text-[15px] text-silver-mist">Bank details</span>
          <Field htmlFor="profile-bank-name" label="Account holder name">
            <Input
              id="profile-bank-name"
              value={draft.bank_account_name}
              onChange={(e) => set("bank_account_name", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor="profile-acc-no" label="Account number">
              <Input
                id="profile-acc-no"
                mono
                inputMode="numeric"
                value={draft.bank_account_number}
                onChange={(e) => set("bank_account_number", e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field htmlFor="profile-ifsc" label="IFSC code">
              <Input
                id="profile-ifsc"
                mono
                value={draft.bank_ifsc}
                onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())}
                placeholder="HDFC0001234"
                autoComplete="off"
              />
            </Field>
          </div>
          <Field htmlFor="profile-bank" label="Bank name">
            <Input id="profile-bank" value={draft.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
          </Field>
        </div>

        <Button loading={isPending} onClick={submit}>
          Save changes
        </Button>
      </CardBody>
    </Card>
  );
}
