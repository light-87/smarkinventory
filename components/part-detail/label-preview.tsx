import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PartLabel } from "@/lib/part-events/types";
import type { PartRow } from "@/types/db";
import { PartQrCode } from "./part-qr-code";

export interface LabelPreviewProps {
  part: PartRow;
  label: PartLabel;
  canWrite: boolean;
  printing: boolean;
  onPrint: () => void;
  className?: string;
}

/** ESD-plastic label preview (real QR + human text) + queue-to-print action (FEATURES.md §8). */
export function LabelPreview({ part, label, canWrite, printing, onPrint, className }: LabelPreviewProps) {
  return (
    <div className={cn("rounded-xl border border-charcoal p-4", className)}>
      <div className="flex items-center gap-4">
        <div className="flex-none rounded-lg bg-snow p-2">
          <PartQrCode value={part.internal_pid} size={72} />
        </div>
        <div className="min-w-0 font-mono text-xs leading-relaxed break-words text-snow">{label.humanText}</div>
      </div>
      {canWrite && (
        <Button variant="outline" fullWidth className="mt-3.5" onClick={onPrint} loading={printing}>
          {label.printStatus === "queued" ? "Queued for printing" : "Print label"}
        </Button>
      )}
    </div>
  );
}
