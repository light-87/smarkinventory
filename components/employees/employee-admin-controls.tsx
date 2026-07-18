"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  resetEmployeePasswordAction,
  setEmployeeActiveAction,
  updateEmployeeAsOwnerAction,
} from "@/lib/employees/actions";
import type { EmployeeDirectoryEntry } from "@/lib/employees/types";

type Panel = "edit" | "password" | null;

interface EditDraft {
  display_name: string;
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

function draftFrom(entry: EmployeeDirectoryEntry): EditDraft {
  const p = entry.privateFields;
  return {
    display_name: entry.profile.display_name ?? "",
    birth_date: entry.profile.birth_date ?? "",
    date_of_joining: entry.profile.date_of_joining ?? "",
    email: p?.email ?? "",
    phone: p?.phone ?? "",
    pan_number: p?.pan_number ?? "",
    bank_account_name: p?.bank_account_name ?? "",
    bank_account_number: p?.bank_account_number ?? "",
    bank_ifsc: p?.bank_ifsc ?? "",
    bank_name: p?.bank_name ?? "",
  };
}

/**
 * Owner-only management row for one employee card (Settings → Employees):
 * edit their profile, reset their password, and archive ("employee left") /
 * reactivate. Every action goes through an owner-gated Server Action
 * (lib/employees/actions.ts) whose real enforcement is `smark_role()` + RLS.
 * Rendered only when the caller is the owner (the page passes `canEdit`).
 */
export function EmployeeAdminControls({ entry, archived }: { entry: EmployeeDirectoryEntry; archived: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(entry));
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  const targetUserId = entry.profile.id;

  function set<K extends keyof EditDraft>(key: K, value: EditDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function saveEdit() {
    if (!draft.display_name.trim()) {
      push({ msg: "Enter a name." });
      return;
    }
    startTransition(async () => {
      const result = await updateEmployeeAsOwnerAction({
        targetUserId,
        display_name: draft.display_name.trim(),
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
        push({ msg: "Saved" });
        setPanel(null);
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function resetPassword() {
    if (password.length < 8) {
      push({ msg: "Password must be at least 8 characters." });
      return;
    }
    startTransition(async () => {
      const result = await resetEmployeePasswordAction({ targetUserId, password });
      if (result.ok) {
        push({ msg: "Password reset — share it with the employee." });
        setPassword("");
        setPanel(null);
      } else {
        push({ msg: result.error });
      }
    });
  }

  function setActive(active: boolean) {
    startTransition(async () => {
      const result = await setEmployeeActiveAction({ targetUserId, active });
      if (result.ok) {
        push({ msg: active ? "Reactivated" : "Archived — their login is disabled." });
        setConfirmArchive(false);
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <div className="border-t border-border-faint pt-3.5">
      {archived ? (
        <Button size="sm" variant="success" loading={isPending} onClick={() => setActive(true)}>
          Reactivate
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPanel(panel === "edit" ? null : "edit")}>
            Edit details
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPanel(panel === "password" ? null : "password")}>
            Reset password
          </Button>
          {confirmArchive ? (
            <>
              <span className="text-caption text-smoke">Employee left?</span>
              <Button size="sm" variant="danger" loading={isPending} onClick={() => setActive(false)}>
                Archive &amp; disable login
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(true)}>
              Employee left…
            </Button>
          )}
        </div>
      )}

      {panel === "edit" && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-charcoal p-3.5">
          <Field htmlFor={`edit-name-${targetUserId}`} label="Name">
            <Input id={`edit-name-${targetUserId}`} value={draft.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor={`edit-dob-${targetUserId}`} label="Date of birth">
              <Input id={`edit-dob-${targetUserId}`} type="date" mono value={draft.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
            </Field>
            <Field htmlFor={`edit-doj-${targetUserId}`} label="Date of joining">
              <Input id={`edit-doj-${targetUserId}`} type="date" mono value={draft.date_of_joining} onChange={(e) => set("date_of_joining", e.target.value)} />
            </Field>
            <Field htmlFor={`edit-email-${targetUserId}`} label="Email">
              <Input id={`edit-email-${targetUserId}`} type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />
            </Field>
            <Field htmlFor={`edit-phone-${targetUserId}`} label="Phone">
              <Input id={`edit-phone-${targetUserId}`} type="tel" inputMode="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field htmlFor={`edit-pan-${targetUserId}`} label="PAN number">
            <Input id={`edit-pan-${targetUserId}`} mono value={draft.pan_number} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} placeholder="ABCDE1234F" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor={`edit-bankname-${targetUserId}`} label="Account holder">
              <Input id={`edit-bankname-${targetUserId}`} value={draft.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} autoComplete="off" />
            </Field>
            <Field htmlFor={`edit-accno-${targetUserId}`} label="Account number">
              <Input id={`edit-accno-${targetUserId}`} mono inputMode="numeric" value={draft.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} autoComplete="off" />
            </Field>
            <Field htmlFor={`edit-ifsc-${targetUserId}`} label="IFSC code">
              <Input id={`edit-ifsc-${targetUserId}`} mono value={draft.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())} placeholder="HDFC0001234" autoComplete="off" />
            </Field>
            <Field htmlFor={`edit-bank-${targetUserId}`} label="Bank name">
              <Input id={`edit-bank-${targetUserId}`} value={draft.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="accent" loading={isPending} onClick={saveEdit}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "password" && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-charcoal p-3.5">
          <Field htmlFor={`reset-pw-${targetUserId}`} label="New password">
            <Input
              id={`reset-pw-${targetUserId}`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="accent" loading={isPending} onClick={resetPassword}>
              Set password
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPanel(null); setPassword(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
