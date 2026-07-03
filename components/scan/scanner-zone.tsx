"use client";

import type { KeyboardEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export interface ScannerZoneProps {
  code: string;
  onCodeChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  cameraOn: boolean;
  cameraError: string | null;
  fallbackContainerId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onToggleCamera: () => void;
}

/**
 * The scanner zone (plan/tab-scan.md: "camera-frame mock + focused code
 * input"). The 112×112 frame shows corner brackets + an orange scan-line
 * while idle, and swaps to the live camera feed once toggled on — the same
 * element hosts both the native `BarcodeDetector` `<video>` and the
 * html5-qrcode fallback's container (only one is ever actually streaming).
 */
export function ScannerZone({
  code,
  onCodeChange,
  onKeyDown,
  cameraOn,
  cameraError,
  fallbackContainerId,
  videoRef,
  onToggleCamera,
}: ScannerZoneProps) {
  return (
    <div className="mb-6 flex items-stretch gap-4">
      <div className="relative size-28 flex-none overflow-hidden rounded-2xl bg-surface-well">
        {!cameraOn && (
          <>
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
          </>
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          className={cn("size-full object-cover", cameraOn ? "block" : "hidden")}
        />
        <div id={fallbackContainerId} className={cn("absolute inset-0", cameraOn ? "block" : "hidden")} />
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
          <Button variant="outline" size="sm" onClick={onToggleCamera}>
            {cameraOn ? "Stop camera" : "Camera"}
          </Button>
          {cameraError && <span className="text-caption text-smark-orange-soft">{cameraError}</span>}
        </div>
      </div>
    </div>
  );
}
