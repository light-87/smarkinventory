/**
 * components/scan/offline-banner.tsx — "N queued — will sync"
 * (plan/tab-scan.md OFFLINE note). Rendered whenever the local offline
 * movement queue is non-empty, cleared automatically as `useScanner` syncs
 * on reconnect.
 */
export interface OfflineBannerProps {
  count: number;
}

export function OfflineBanner({ count }: OfflineBannerProps) {
  if (count <= 0) return null;
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-smark-orange/40 bg-surface-accent px-4 py-3 text-body-sm text-snow">
      <span aria-hidden className="size-2 flex-none rounded-full bg-smark-orange" />
      {count} queued — will sync
    </div>
  );
}
