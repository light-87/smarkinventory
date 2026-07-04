"use client";

import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ScannerZoneProps {
  code: string;
  onCodeChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Opens the full-screen camera overlay (components/scan/camera-scanner.tsx). */
  onOpenCamera: () => void;
}

/**
 * The scanner zone (plan/tab-scan.md: "camera-frame mock + focused code
 * input"). The 112×112 frame is a purely decorative idle mock (corner
 * brackets + an orange scan-line) — the "Camera" button opens the full-
 * screen live camera overlay instead of streaming inline here, so this
 * frame never itself shows video.
 */
export function ScannerZone({ code, onCodeChange, onKeyDown, onOpenCamera }: ScannerZoneProps) {
  return (
    <div className="mb-6 flex items-stretch gap-4">
      <div className="relative size-28 flex-none overflow-hidden rounded-2xl bg-surface-well">
        <span
          aria-hidden
          className="absolute top-3 left-3 size-5 rounded-tl-md border-t-2 border-l-2 border-graphite"
        />
        <span
          aria-hidden
          className="absolute top-3 right-3 size-5 rounded-tr-md border-t-2 border-r-2 border-graphite"
        />
        <span
          aria-hidden
          className="absolute bottom-3 left-3 size-5 rounded-bl-md border-b-2 border-l-2 border-graphite"
        />
        <span
          aria-hidden
          className="absolute bottom-3 right-3 size-5 rounded-br-md border-b-2 border-r-2 border-graphite"
        />
        <span aria-hidden className="absolute inset-x-3 top-1/2 h-0.5 bg-smark-orange/70" />
      </div>

      <div className="flex flex-1 flex-col justify-center gap-2.5">
        <Input
          uiSize="lg"
          mono
          autoFocus
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Scan or type a code…"
          className="h-[52px] text-base"
          aria-label="Scan or type a code"
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={onOpenCamera}>
            Camera
          </Button>
        </div>
      </div>
    </div>
  );
}
