import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface ExportPanelProps {
  defaultDate: string;
  personParam: string;
}

/**
 * R2-33 — "Export a day (or range) as CSV/xlsx". Plain `<form method="get">`
 * to the export Route Handler (app/(app)/daily/export/route.ts) — no client
 * JS needed, the browser just downloads the response (Content-Disposition:
 * attachment).
 */
export function ExportPanel({ defaultDate, personParam }: ExportPanelProps) {
  return (
    <Card padding="none">
      <CardHeader title="Export" />
      <form method="get" action="/daily/export" className="flex flex-wrap items-end gap-3 px-5 py-[18px]">
        <input type="hidden" name="person" value={personParam} />
        <label className="flex flex-col gap-1.5 text-[13px] text-silver-mist">
          From
          <input
            type="date"
            name="from"
            defaultValue={defaultDate}
            className="h-10 rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-silver-mist">
          To
          <input
            type="date"
            name="to"
            defaultValue={defaultDate}
            className="h-10 rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-silver-mist">
          Format
          <select
            name="format"
            defaultValue="xlsx"
            className="h-10 rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <Button type="submit" variant="outline">
          Download
        </Button>
      </form>
    </Card>
  );
}
