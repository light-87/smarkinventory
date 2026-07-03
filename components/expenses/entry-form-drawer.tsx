"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { Field, Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { confirmDraftAction, createEntryAction, updateEntryAction, uploadEntryAttachmentAction } from "@/lib/expenses/actions";
import { toDateOnlyString } from "@/lib/format";
import type { AccountOption, EntryListItem, ProjectOption } from "@/lib/expenses/types";
import type { ExpenseCategory, ExpenseEntryType } from "@/types/db";
import { CategoryChips } from "./category-chips";
import { NativeSelect } from "./native-select";

export type EntryFormMode = "create" | "edit" | "confirm";

export interface EntryFormDrawerProps {
  open: boolean;
  mode: EntryFormMode;
  entry: EntryListItem | null;
  accounts: AccountOption[];
  projects: ProjectOption[];
  onClose: () => void;
  onSaved: () => void;
}

interface DraftState {
  entry_type: ExpenseEntryType;
  amount: string;
  entry_date: string;
  category: ExpenseCategory | null;
  account_id: string;
  vendor: string;
  project_id: string;
  note: string;
  gstin: string;
  tax_amount: string;
  attachment_url: string | null;
}

function emptyDraft(): DraftState {
  return {
    entry_type: "expense",
    amount: "",
    entry_date: toDateOnlyString(new Date()) ?? "",
    category: null,
    account_id: "",
    vendor: "",
    project_id: "",
    note: "",
    gstin: "",
    tax_amount: "",
    attachment_url: null,
  };
}

function draftFromEntry(entry: EntryListItem): DraftState {
  return {
    entry_type: entry.entry_type,
    amount: String(entry.amount),
    entry_date: entry.entry_date,
    category: entry.category,
    account_id: entry.account_id ?? "",
    vendor: entry.vendor ?? "",
    project_id: entry.project_id ?? "",
    note: entry.note ?? "",
    gstin: entry.gstin ?? "",
    tax_amount: entry.tax_amount != null ? String(entry.tax_amount) : "",
    attachment_url: entry.attachment_url,
  };
}

const TITLES: Record<EntryFormMode, string> = {
  create: "Add entry",
  edit: "Edit entry",
  confirm: "Confirm draft",
};

/**
 * Add/edit/confirm-draft form, shared across all three (plan/tab-expenses.md
 * R2-20: "confirm/edit → real"). Plain controlled state rather than
 * react-hook-form — same call as components/receive/new-part-form.tsx
 * (amount/tax_amount are text inputs but zod-typed as numbers server-side;
 * the Server Action's zod schema, lib/expenses/validation.ts, is the real
 * validation boundary, this is just a light pre-submit check).
 */
/**
 * State is seeded once via lazy `useState` initializers rather than an
 * effect that calls `setState` on `[open, entry]` changes (React docs "You
 * Might Not Need An Effect" — resetting state on prop change is a `key`
 * problem, not an effect problem): the caller
 * (components/expenses/expenses-client.tsx) mounts this with a `key` that
 * changes every time the drawer is opened, so React remounts the whole
 * component — and re-runs these initializers — instead of this component
 * reacting to a prop change after the fact.
 */
export function EntryFormDrawer({ open, mode, entry, accounts, projects, onClose, onSaved }: EntryFormDrawerProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState<DraftState>(() => (entry ? draftFromEntry(entry) : emptyDraft()));
  const [showGst, setShowGst] = useState<boolean>(() => Boolean(draft.gstin || draft.tax_amount));

  if (!open) return null;

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const activeAccounts = accounts.filter((a) => a.active || a.id === draft.account_id);

  async function handleAttachmentChange(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadEntryAttachmentAction(formData);
      if (result.ok) {
        set("attachment_url", result.url);
      } else {
        push({ msg: result.error });
      }
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    const amount = Number.parseFloat(draft.amount);
    if (!draft.category) return push({ msg: "Pick a category" });
    if (!Number.isFinite(amount) || amount <= 0) return push({ msg: "Amount must be greater than 0" });
    if (!draft.entry_date) return push({ msg: "Date is required" });
    if (!draft.account_id) return push({ msg: "Pick an account" });

    const taxAmount = draft.tax_amount.trim() ? Number.parseFloat(draft.tax_amount) : null;
    if (draft.tax_amount.trim() && (!Number.isFinite(taxAmount!) || taxAmount! < 0)) {
      return push({ msg: "Tax amount must be a positive number" });
    }

    const input = {
      entry_type: draft.entry_type,
      amount,
      entry_date: draft.entry_date,
      category: draft.category,
      account_id: draft.account_id,
      vendor: draft.vendor.trim() || null,
      gstin: draft.gstin.trim() || null,
      tax_amount: taxAmount,
      project_id: draft.project_id || null,
      note: draft.note.trim() || null,
      attachment_url: draft.attachment_url,
    };

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createEntryAction(input)
          : mode === "confirm" && entry
            ? await confirmDraftAction(entry.id, input)
            : entry
              ? await updateEntryAction(entry.id, input)
              : { ok: false as const, error: "Missing entry." };

      if (result.ok) {
        push({ msg: mode === "confirm" ? "Draft confirmed" : mode === "edit" ? "Entry updated" : "Entry added" });
        onSaved();
        onClose();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Drawer open={open} onClose={onClose} aria-label={TITLES[mode]}>
      <DrawerHeader>
        <div>
          <div className="text-[15px] font-medium text-snow">{TITLES[mode]}</div>
          {mode === "confirm" && <div className="mt-1 text-caption text-smoke">From a placed order — assign an account to make it real.</div>}
        </div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>

      <DrawerBody>
        <div className="flex flex-col gap-5">
          <div>
            <SectionLabel className="mb-2">Type</SectionLabel>
            <SegmentedControl
              options={[
                { value: "expense" as const, label: "Expense" },
                { value: "income" as const, label: "Income" },
              ]}
              value={draft.entry_type}
              onChange={(v) => set("entry_type", v)}
              variant="accent"
              aria-label="Entry type"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="expense-amount" label={<>Amount ₹ <span className="text-smark-orange">*</span></>}>
              <Input
                id="expense-amount"
                value={draft.amount}
                onChange={(e) => set("amount", e.target.value)}
                type="number"
                inputMode="decimal"
                mono
                placeholder="0.00"
              />
            </Field>
            <Field htmlFor="expense-date" label={<>Date <span className="text-smark-orange">*</span></>}>
              <Input id="expense-date" value={draft.entry_date} onChange={(e) => set("entry_date", e.target.value)} type="date" mono />
            </Field>
          </div>

          <div>
            <SectionLabel className="mb-2">
              Category <span className="text-smark-orange">*</span>
            </SectionLabel>
            <CategoryChips value={draft.category} onChange={(v) => set("category", v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="expense-account" label={<>Account <span className="text-smark-orange">*</span></>}>
              <NativeSelect
                id="expense-account"
                value={draft.account_id}
                onChange={(e) => set("account_id", e.target.value)}
                placeholder={activeAccounts.length ? "Select account" : "No accounts yet"}
                options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <Field htmlFor="expense-project" label="Project" hint="Set = this is a project payment">
              <NativeSelect
                id="expense-project"
                value={draft.project_id}
                onChange={(e) => set("project_id", e.target.value)}
                placeholder="No project"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
          </div>

          <Field htmlFor="expense-vendor" label="Vendor / party">
            <Input
              id="expense-vendor"
              value={draft.vendor}
              onChange={(e) => set("vendor", e.target.value)}
              placeholder="Distributor or person"
            />
          </Field>

          <Field htmlFor="expense-note" label="Note">
            <textarea
              id="expense-note"
              value={draft.note}
              onChange={(e) => set("note", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-charcoal bg-surface-well px-3.5 py-2.5 text-sm text-snow outline-none focus:border-smark-orange"
            />
          </Field>

          <Field label="Attachment (bill / receipt)">
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleAttachmentChange(e.target.files?.[0] ?? null)}
                className="text-xs text-smoke file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-charcoal file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:text-snow"
              />
              {uploading && <span className="text-xs text-smoke">Uploading…</span>}
              {draft.attachment_url && !uploading && (
                <Button size="sm" variant="ghost" onClick={() => set("attachment_url", null)}>
                  Remove
                </Button>
              )}
            </div>
          </Field>

          {showGst ? (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-charcoal p-3">
              <Field htmlFor="expense-gstin" label="GSTIN">
                <Input id="expense-gstin" value={draft.gstin} onChange={(e) => set("gstin", e.target.value)} mono placeholder="27AAAAA0000A1Z5" />
              </Field>
              <Field htmlFor="expense-tax-amount" label="Tax amount ₹">
                <Input
                  id="expense-tax-amount"
                  value={draft.tax_amount}
                  onChange={(e) => set("tax_amount", e.target.value)}
                  type="number"
                  inputMode="decimal"
                  mono
                />
              </Field>
            </div>
          ) : (
            <button type="button" onClick={() => setShowGst(true)} className="w-fit cursor-pointer text-[13px] text-smoke transition-colors hover:text-snow">
              + Add GST details
            </button>
          )}
        </div>
      </DrawerBody>

      <DrawerFooter>
        <Button variant="outline" onClick={onClose} fullWidth>
          Cancel
        </Button>
        <Button onClick={submit} loading={isPending} fullWidth>
          {mode === "confirm" ? "Confirm" : "Save"}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
