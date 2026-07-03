"use client";

import { BoxScanCard } from "@/components/scan/box-scan-card";
import { OfflineBanner } from "@/components/scan/offline-banner";
import { PartScanCard } from "@/components/scan/part-scan-card";
import { ScannerZone } from "@/components/scan/scanner-zone";
import { EmptyState } from "@/components/ui/empty-state";
import { useScanner } from "@/hooks/use-scanner";

export interface ScanScreenProps {
  /**
   * FEATURES.md §2: accountant is read-only on Scan — Take out/Add render
   * disabled (see `PartScanCard`) and the write path also pre-checks
   * server-side (`lib/scan/actions.ts`). Computed server-side in
   * `app/(app)/scan/page.tsx` via `getSessionUser()` + `canWrite(role, "scan")`.
   */
  canWrite: boolean;
}

/**
 * /scan — the technician's fastest loop (FEATURES.md §5.5, plan/tab-scan.md).
 * Scan an ESD label → adjust qty in seconds, with undo. Scan a box label →
 * audit or receive into it.
 *
 * `app/(app)/layout.tsx` (auth-shell's rail/bottom-bar/header shell) already
 * mounts one `<ToastViewport />` globally (components/shell/app-shell.tsx) —
 * this page does NOT mount a second one.
 */
export function ScanScreen({ canWrite }: ScanScreenProps) {
  const scanner = useScanner({ canWrite });

  return (
    <main className="mx-auto max-w-[720px] px-6 pt-7 pb-24">
      <h1 className="mb-1 text-heading-sm font-normal text-snow">Scan</h1>
      <p className="mb-6 text-body-sm text-smoke">
        Scan an ESD label to adjust stock, or a Big-Box label to see what&apos;s inside.
      </p>

      <OfflineBanner count={scanner.queuedCount} />

      <ScannerZone
        code={scanner.code}
        onCodeChange={scanner.onCodeChange}
        onKeyDown={scanner.onKeyDown}
        cameraOn={scanner.cameraOn}
        cameraError={scanner.cameraError}
        fallbackContainerId={scanner.fallbackContainerId}
        videoRef={scanner.videoRef}
        onToggleCamera={scanner.toggleCamera}
      />

      {!scanner.resolution && (
        <EmptyState
          tone="subtle"
          description={
            scanner.resolving
              ? "Resolving…"
              : "Point the camera at an ESD-plastic or Big-Box QR — or scan/type a code above."
          }
        />
      )}

      {scanner.resolution?.type === "part" && (
        <PartScanCard
          data={scanner.resolution.data}
          step={scanner.step}
          onStepChange={scanner.setStep}
          selectedLocationId={scanner.selectedLocationId}
          onSelectLocation={scanner.selectLocation}
          onTakeOut={scanner.takeOut}
          onAdd={scanner.addStock}
          pending={scanner.actionPending}
          canWrite={canWrite}
        />
      )}

      {scanner.resolution?.type === "box" && <BoxScanCard data={scanner.resolution.data} />}
    </main>
  );
}
