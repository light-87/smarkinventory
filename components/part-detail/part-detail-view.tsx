"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { queuePartLabelPrint, undoStockMovement } from "@/lib/part-events/actions";
import { distinctEventTypes, distinctProjects, filterTimeline } from "@/lib/part-events/timeline";
import type { PartDetailData, TimelineFilterState } from "@/lib/part-events/types";
import type { PartStatus } from "@/types/db";
import { AdjustQtyDialog } from "./adjust-qty-dialog";
import { ContestedStockStrip } from "./contested-stock-strip";
import { LabelPreview } from "./label-preview";
import { LocationsTable } from "./locations-table";
import { SpecsGrid } from "./specs-grid";
import { TimelineFilters } from "./timeline-filters";
import { TimelineList } from "./timeline-list";

const STATUS_LABEL: Record<PartStatus, string> = { active: "Active", nrnd: "NRND", eol: "EOL" };
const STATUS_TONE: Record<PartStatus, ChipTone> = { active: "success", nrnd: "accent", eol: "accent" };

export interface PartDetailViewProps {
  data: PartDetailData;
  /** drawer = `?pid=` overlay from Inventory; page = `/part/[pid]` standalone deep link. */
  variant: "drawer" | "page";
  onClose?: () => void;
}

/**
 * The part-detail content shared by the Inventory drawer and the `/part/[pid]`
 * page (tab-part-detail.md). `DrawerHeader`/`DrawerBody`/`DrawerFooter` are
 * plain sticky-positioned wrappers (components/ui/drawer.tsx) — reused as-is
 * for the page variant too, which just isn't inside a `<Drawer>` overlay.
 */
export function PartDetailView({ data, variant, onClose }: PartDetailViewProps) {
  const router = useRouter();
  const { push } = useToast();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [printPending, startPrintTransition] = useTransition();
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilterState>({ eventTypes: [], projectId: null });

  const availableEventTypes = useMemo(() => distinctEventTypes(data.timeline), [data.timeline]);
  const availableProjects = useMemo(() => distinctProjects(data.timeline), [data.timeline]);
  const filteredTimeline = useMemo(() => filterTimeline(data.timeline, timelineFilter), [data.timeline, timelineFilter]);

  function handlePrint() {
    startPrintTransition(async () => {
      const result = await queuePartLabelPrint({ part: data.part });
      if (result.ok) {
        push({ msg: `Label for ${data.part.internal_pid} queued for printing` });
        router.refresh();
      } else {
        push({ msg: result.error, dismissable: true, timeout: 0 });
      }
    });
  }

  return (
    <>
      <DrawerHeader>
        <div className="min-w-0">
          <div className="font-mono text-2xl text-snow">{data.part.internal_pid}</div>
          {data.part.mpn && <div className="mt-1 truncate font-mono text-[13px] text-silver-mist">{data.part.mpn}</div>}
          {data.part.manufacturer && <div className="mt-0.5 text-[13px] text-smoke">{data.part.manufacturer}</div>}
        </div>
        <div className="flex flex-none items-center gap-3">
          <Chip tone={STATUS_TONE[data.part.part_status]}>{STATUS_LABEL[data.part.part_status]}</Chip>
          {variant === "drawer" ? (
            <DrawerCloseButton onClick={onClose} />
          ) : (
            <button
              type="button"
              onClick={() => router.push("/inventory")}
              className="cursor-pointer text-[13px] text-smoke hover:text-snow"
            >
              ← Inventory
            </button>
          )}
        </div>
      </DrawerHeader>

      <DrawerBody>
        {data.contested && <ContestedStockStrip contested={data.contested} className="mb-6" />}

        <SectionLabel className="mb-3">Specifications</SectionLabel>
        <SpecsGrid specs={data.specs} className="mb-2" />
        {data.part.datasheet_url && (
          <a
            href={data.part.datasheet_url}
            target="_blank"
            rel="noreferrer"
            className="mb-6 inline-block text-[13px] text-smark-orange-soft hover:underline"
          >
            Datasheet ↗
          </a>
        )}

        <SectionLabel className="mt-6 mb-3">Locations</SectionLabel>
        <LocationsTable locations={data.locations} className="mb-6" />

        <SectionLabel className="mb-3">ESD-plastic label</SectionLabel>
        <LabelPreview
          part={data.part}
          label={data.label}
          canWrite={data.canWrite}
          printing={printPending}
          onPrint={handlePrint}
          className="mb-6"
        />

        <SectionLabel className="mb-3">
          History <span className="text-faint normal-case tracking-normal">· living record</span>
        </SectionLabel>
        <TimelineFilters
          availableEventTypes={availableEventTypes}
          availableProjects={availableProjects}
          value={timelineFilter}
          onChange={setTimelineFilter}
        />
        {data.timeline.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-smoke">No history yet for this part.</p>
        ) : filteredTimeline.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-smoke">No events match these filters.</p>
        ) : (
          <TimelineList entries={filteredTimeline} />
        )}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="primary" fullWidth onClick={() => router.push(`/cart?part_id=${data.part.id}`)}>
          Order more
        </Button>
        {data.canWrite && (
          <Button
            variant="outline"
            onClick={() => setAdjustOpen(true)}
            disabled={data.locations.length === 0}
            title={data.locations.length === 0 ? "No physical location yet — send through Receive onboarding first." : undefined}
          >
            Adjust qty
          </Button>
        )}
      </DrawerFooter>

      <AdjustQtyDialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        part={data.part}
        locations={data.locations}
        onAdjusted={(result) => {
          setAdjustOpen(false);
          push({
            msg: `${result.delta > 0 ? "Added" : "Removed"} ${Math.abs(result.delta)} × ${data.part.internal_pid}`,
            undo: true,
            onUndo: () => {
              void (async () => {
                const undoResult = await undoStockMovement(result.movementId);
                if (undoResult.ok) {
                  push({ msg: "Undone" });
                  router.refresh();
                } else {
                  push({ msg: undoResult.error, dismissable: true, timeout: 0 });
                }
              })();
            },
          });
          router.refresh();
        }}
      />
    </>
  );
}
