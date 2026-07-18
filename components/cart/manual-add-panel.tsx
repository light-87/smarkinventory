"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { addManualCartLineAction, searchPartsForManualAddAction } from "@/lib/orders/actions";
import type { PartSearchHit } from "@/lib/orders/queries";

/** "Manual add: search any part → add qty" (§3-A — non-BOM needs). */
export function ManualAddPanel({ canWrite }: { canWrite: boolean }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PartSearchHit[]>([]);
  const [qtyByPart, setQtyByPart] = useState<Record<string, string>>({});
  const [isSearching, startSearch] = useTransition();
  const [isAdding, startAdd] = useTransition();

  if (!canWrite) return null;

  function runSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const hits = await searchPartsForManualAddAction(value);
      setResults(hits);
    });
  }

  function add(hit: PartSearchHit) {
    const raw = qtyByPart[hit.id] ?? "1";
    const qty = Number.parseInt(raw, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      push({ msg: "Enter a positive quantity" });
      return;
    }
    startAdd(async () => {
      const result = await addManualCartLineAction({ partId: hit.id, qty });
      if (result.ok) {
        push({ msg: result.merged ? `Bumped ${hit.internalPid} in cart` : `Added ${hit.internalPid} to cart` });
        setQuery("");
        setResults([]);
      } else {
        push({ msg: result.error });
      }
    });
  }

  if (!open) {
    return (
      <Button variant="accent-outline" onClick={() => setOpen(true)}>
        + Add a part manually
      </Button>
    );
  }

  return (
    <Card padding="lg">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Manual add</SectionLabel>
        <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-caption text-smoke hover:text-snow">
          Close
        </button>
      </div>
      <Input
        placeholder="Search PID, MPN, or value…"
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        autoFocus
      />
      {isSearching && <div className="mt-2 text-caption text-smoke">Searching…</div>}
      {results.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {results.map((hit) => (
            <div
              key={hit.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-charcoal px-3 py-2"
            >
              <div className="min-w-0 text-[15px]">
                <span className="font-mono text-snow">{hit.internalPid}</span>{" "}
                <span className="text-silver-mist">{hit.mpn ?? hit.value ?? "—"}</span>{" "}
                <span className="text-smoke">
                  · {hit.package ?? "—"} · {hit.totalQty.toLocaleString("en-IN")} in stock
                </span>
              </div>
              <div className="flex flex-none items-center gap-2">
                <Input
                  uiSize="sm"
                  mono
                  type="number"
                  inputMode="numeric"
                  className="w-20"
                  value={qtyByPart[hit.id] ?? "1"}
                  onChange={(e) => setQtyByPart((prev) => ({ ...prev, [hit.id]: e.target.value }))}
                />
                <Button size="sm" variant="outline" onClick={() => add(hit)} loading={isAdding}>
                  Add
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!isSearching && query.trim().length >= 2 && results.length === 0 && (
        <div className="mt-2 text-caption text-smoke">No parts match “{query}”.</div>
      )}
    </Card>
  );
}
