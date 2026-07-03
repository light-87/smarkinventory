"use client";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatINR } from "@/lib/format";
import type { EntryListItem } from "@/lib/expenses/types";

export interface EntryTableProps {
  entries: EntryListItem[];
  onEdit: (entry: EntryListItem) => void;
  onConfirmDraft: (entry: EntryListItem) => void;
  onDelete: (entry: EntryListItem) => void;
}

export function EntryTable({ entries, onEdit, onConfirmDraft, onDelete }: EntryTableProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No entries match these filters"
        description="Try widening the month range or clearing a filter."
      />
    );
  }

  return (
    <TableShell minWidth={860}>
      <TableHead>
        <Tr>
          <Th>Date</Th>
          <Th>Type</Th>
          <Th align="right">Amount</Th>
          <Th>Category</Th>
          <Th>Account</Th>
          <Th>Vendor / party</Th>
          <Th>Project</Th>
          <Th align="right">Actions</Th>
        </Tr>
      </TableHead>
      <TableBody>
        {entries.map((entry) => (
          <Tr key={entry.id}>
            <Td mono>{formatDate(entry.entry_date)}</Td>
            <Td>
              <Chip tone={entry.entry_type === "income" ? "success" : "default"} size="sm">
                {entry.entry_type === "income" ? "Income" : "Expense"}
              </Chip>
              {entry.is_draft && (
                <Chip tone="accent" size="sm" className="ml-1.5">
                  Draft
                </Chip>
              )}
            </Td>
            <Td
              mono
              align="right"
              className={entry.entry_type === "income" ? "text-phosphor-green" : "text-snow"}
            >
              {entry.entry_type === "income" ? "+" : "−"}
              {formatINR(entry.amount)}
            </Td>
            <Td>{entry.category}</Td>
            <Td>{entry.accountName ?? "—"}</Td>
            <Td className="max-w-[180px] truncate">{entry.vendor ?? "—"}</Td>
            <Td className="max-w-[160px] truncate">{entry.projectName ?? "—"}</Td>
            <Td align="right">
              <div className="flex justify-end gap-2">
                {entry.is_draft ? (
                  <Button size="sm" variant="accent-outline" onClick={() => onConfirmDraft(entry)}>
                    Review
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => onEdit(entry)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </TableBody>
    </TableShell>
  );
}
