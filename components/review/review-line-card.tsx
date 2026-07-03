"use client";

/**
 * components/review/review-line-card.tsx — one Order Review line
 * (plan/tab-order-review.md §2): option radio table (recommended
 * pre-selected), confidence + "AI · why", View listing ↗, ↺ Re-run this
 * item, qty + Add to cart (the review's ONLY order action, R2-08), and the
 * per-item 💬 feedback toggle → suggested rule (scope Part).
 *
 * Selection persists on `smark_agent_results.selected` (lib/runs/select.ts)
 * — reopening a sourced BOM's review later renders from that same column,
 * so this component always seeds its local radio state from `row.selected`
 * first, falling back to the deterministic `isRecommended` pick only when
 * nothing has ever been selected yet.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addToCartAction,
  reRunItemAction,
  selectReviewOptionAction,
  submitItemFeedbackAction,
} from "@/app/(app)/projects/[projectId]/runs/[runId]/actions";
import { formatINR, formatNumber } from "@/lib/format";
import type { ReviewLineCard as ReviewLineCardData } from "@/lib/runs/types";

export interface ReviewLineCardProps {
  projectId: string;
  runId: string;
  writable: boolean;
  line: ReviewLineCardData;
}

function matchGlyph(ok: boolean | "exact" | "approx" | "none") {
  if (ok === true || ok === "exact") return { glyph: "✓", className: "text-phosphor-green" };
  if (ok === "approx") return { glyph: "~", className: "text-smark-orange" };
  return { glyph: "✗", className: "text-smoke" };
}

/**
 * Three distinct tiers matching the locked prototype (SmarkStock.dc.html:1556
 * review-lane `confColor`) — high=silver-mist (NOT green), mid=orange-soft,
 * low=full orange. The two Chip tones this design system ships (`neutral` →
 * silver-mist text, `accent` → full smark-orange) cover the high/low ends
 * exactly; the mid tier has no dedicated Chip tone, so it reuses `accent`'s
 * structure with a `className` override to the soft-orange token instead of
 * proposing a new tone to the (integrator-locked) Chip component for one
 * screen's use.
 */
function confidenceTone(confidence: number | null): { tone: "success" | "accent" | "neutral"; label: string; className?: string } {
  if (confidence == null) return { tone: "neutral", label: "—" };
  if (confidence >= 80) return { tone: "neutral", label: `${confidence}/100` };
  if (confidence >= 50) return { tone: "accent", label: `${confidence}/100`, className: "border-smark-orange-soft text-smark-orange-soft" };
  return { tone: "accent", label: `${confidence}/100` };
}

export function ReviewLineCard({ projectId, runId, writable, line }: ReviewLineCardProps) {
  const router = useRouter();
  const persistedSelected = useMemo(() => line.rows.find((r) => r.selected) ?? null, [line.rows]);
  const defaultRow = persistedSelected ?? line.rows.find((r) => r.isRecommended) ?? line.rows[0] ?? null;

  const [selectedResultId, setSelectedResultId] = useState<string | null>(defaultRow?.resultId ?? null);
  const [qty, setQty] = useState(String(line.cartQtyNeeded || 1));
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [addedNotice, setAddedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isReRunning, startReRun] = useTransition();
  const [isSendingFeedback, startFeedback] = useTransition();

  const selectedRow = line.rows.find((r) => r.resultId === selectedResultId) ?? null;
  const confidence = confidenceTone(selectedRow?.confidence ?? null);
  const lowConfidence = selectedRow?.confidence != null && selectedRow.confidence < 50;

  function selectOption(resultId: string) {
    setSelectedResultId(resultId);
    setError(null);
    startTransition(async () => {
      const result = await selectReviewOptionAction({ runId, bomLineId: line.bomLineId, resultId });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function addToCart() {
    setError(null);
    setAddedNotice(null);
    if (!selectedRow) {
      setError("Pick an option before adding to cart.");
      return;
    }
    const parsedQty = Number.parseInt(qty, 10);
    if (!Number.isFinite(parsedQty) || parsedQty < 1) {
      setError("Qty must be at least 1.");
      return;
    }
    startTransition(async () => {
      const result = await addToCartAction({ runId, bomLineId: line.bomLineId, resultId: selectedRow.resultId, qty: parsedQty });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddedNotice(result.alreadyInCart ? "Already in cart — qty updated." : "Added to cart ✓");
      router.refresh();
    });
  }

  function reRunItem() {
    setError(null);
    startReRun(async () => {
      const result = await reRunItemAction({ runId, bomLineId: line.bomLineId });
      if (!result.ok) setError(result.error);
      else router.push(`/projects/${projectId}/runs/${runId}`);
    });
  }

  function sendFeedback() {
    if (!feedbackText.trim()) return;
    setError(null);
    startFeedback(async () => {
      const result = await submitItemFeedbackAction({ runId, bomLineId: line.bomLineId, comment: feedbackText.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeedbackSent(true);
      setFeedbackText("");
      router.refresh();
    });
  }

  const inCart = line.inCartQty != null;

  return (
    <Card padding="lg">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-sm text-snow">{line.ref}</div>
          <div className="mt-0.5 truncate text-caption text-smoke">{line.value}</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {inCart && (
            <Chip tone="success" mono>
              In cart ✓ ×{formatNumber(line.inCartQty)}
            </Chip>
          )}
          {writable && (
            <button
              type="button"
              aria-label="Leave feedback on this line"
              onClick={() => setFeedbackOpen((v) => !v)}
              className="flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-full text-smoke transition-colors hover:bg-ash hover:text-snow"
            >
              💬
            </button>
          )}
        </div>
      </div>

      {line.aiSkipReason ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-smark-orange bg-surface-accent-hover px-3.5 py-3">
          <span className="text-sm text-smark-orange">✓</span>
          <span className="text-[13px] text-snow">{line.aiSkipReason}</span>
        </div>
      ) : line.rows.length === 0 ? (
        <div className="rounded-lg border border-charcoal bg-surface-well px-3.5 py-3 text-[13px] text-smoke">
          No listings found across any site in the sequence.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  {["", "Site", "Price", "Stock", "MPN", "Pkg", "Link"].map((h, i) => (
                    <th
                      key={h || `col-${i}`}
                      className={`px-2 py-1 text-[10px] tracking-[0.04em] text-graphite uppercase ${i >= 4 ? "text-center" : i === 2 ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {line.rows.map((row) => {
                  const mpn = matchGlyph(row.mpnMatch);
                  const pkg = matchGlyph(row.packageMatch);
                  const isChecked = row.resultId === selectedResultId;
                  return (
                    <tr key={row.resultId} className={isChecked ? "bg-surface-accent-hover" : undefined}>
                      <td className="border-t border-border-hairline px-2 py-1.5">
                        <input
                          type="radio"
                          name={`review-line-${line.bomLineId}`}
                          aria-label={`Choose ${row.distributorName} for ${line.ref}`}
                          checked={isChecked}
                          disabled={!writable}
                          onChange={() => selectOption(row.resultId)}
                          className="size-4 cursor-pointer accent-smark-orange"
                        />
                      </td>
                      <td className="border-t border-border-hairline px-2 py-1.5 font-mono text-[12px] whitespace-nowrap text-snow">
                        {row.distributorName}
                        {row.isRecommended && (
                          <Chip tone="accent" size="sm" className="ml-1.5">
                            Recommended
                          </Chip>
                        )}
                      </td>
                      <td className="border-t border-border-hairline px-2 py-1.5 text-right font-mono text-[12px] text-snow">{formatINR(row.price)}</td>
                      <td className="border-t border-border-hairline px-2 py-1.5 text-[12px] text-smoke">{formatNumber(row.stockQty)}</td>
                      <td className={`border-t border-border-hairline px-2 py-1.5 text-center text-[13px] ${mpn.className}`}>{mpn.glyph}</td>
                      <td className={`border-t border-border-hairline px-2 py-1.5 text-center text-[13px] ${pkg.className}`}>{pkg.glyph}</td>
                      <td className="border-t border-border-hairline px-2 py-1.5 text-right">
                        {row.orderLink ? (
                          <a href={row.orderLink} target="_blank" rel="noreferrer" className="text-[12px] text-smark-orange-hover hover:underline">
                            Open ↗
                          </a>
                        ) : (
                          <span className="text-[12px] text-graphite">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5 border-t border-border-hairline pt-3.5">
            <span className="text-caption text-smoke">Confidence</span>
            <Chip tone={confidence.tone} mono className={confidence.className}>
              {confidence.label}
            </Chip>
            {lowConfidence && <span className="text-caption text-smark-orange-soft">⚠ verify manually</span>}
            {selectedRow?.orderLink && (
              <a href={selectedRow.orderLink} target="_blank" rel="noreferrer" className="text-caption text-smark-orange-hover hover:underline">
                View recommended listing ↗
              </a>
            )}
          </div>

          {selectedRow && (
            <div className="mt-2 text-[13px] leading-[1.5] text-silver-mist">
              <span className="text-smark-orange">AI ·</span> {selectedRow.why}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border-hairline pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] text-silver-mist">Qty needed</label>
              <Input uiSize="sm" mono type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} disabled={!writable} className="w-24" />
            </div>
            {writable && (
              <Button size="sm" onClick={addToCart} loading={isPending}>
                Add to cart
              </Button>
            )}
            {writable && (
              <Button size="sm" variant="ghost" onClick={reRunItem} loading={isReRunning}>
                ↺ Re-run this item
              </Button>
            )}
            {addedNotice && <span className="text-caption text-phosphor-green">{addedNotice}</span>}
          </div>
        </>
      )}

      {feedbackOpen && (
        <div className="mt-4 border-t border-border-hairline pt-4">
          <div className="mb-1.5 text-caption text-smoke uppercase">Feedback → AI Memory</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              uiSize="sm"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="wrong package · prefer LCSC · we already stock this"
              className="min-w-[220px] flex-1"
            />
            <Button size="sm" variant="outline" onClick={sendFeedback} loading={isSendingFeedback}>
              Send
            </Button>
          </div>
          {feedbackSent && <div className="mt-1.5 text-caption text-phosphor-green">Sent — suggested rule created in AI Memory.</div>}
          {line.feedback.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {line.feedback.map((f) => (
                <div key={f.id} className="text-caption text-smoke">
                  &ldquo;{f.comment}&rdquo;
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {inCart && (
        <div className="mt-3 text-caption text-smoke">
          <Link href="/cart" className="text-smark-orange hover:underline">
            Jump to cart →
          </Link>
        </div>
      )}

      {error && <div className="mt-3 text-caption text-smark-orange-soft">{error}</div>}
    </Card>
  );
}
