import { EmptyState } from "@/components/ui/empty-state";
import type { PortalDocument } from "@/lib/portal/types";

/** Small, self-contained (not `lib/format.ts` — integrator-locked, no byte-size helper lives there). */
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

/** Named uploads explicitly shared to the portal — name + download only, never price/notes (FEATURES §11). */
export function DocumentsList({ documents }: { documents: PortalDocument[] }) {
  if (documents.length === 0) {
    return (
      <EmptyState
        tone="subtle"
        title="No documents yet"
        description="Files Smark shares with you will show up here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {documents.map((doc) => (
        <li key={doc.id}>
          <a
            href={doc.file_url}
            target="_blank"
            rel="noreferrer noopener"
            download={doc.display_name}
            className="flex items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-3 transition-colors hover:border-graphite hover:bg-surface-hover"
          >
            <span className="truncate text-[14px] text-snow">{doc.display_name}</span>
            <span className="flex-none text-caption text-smoke">{formatBytes(doc.size_bytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
