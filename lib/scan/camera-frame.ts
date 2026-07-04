/**
 * lib/scan/camera-frame.ts — pure per-frame decode logic pulled out of
 * components/scan/camera-scanner.tsx so it's unit-testable without a real
 * camera/DOM (tests/unit/scan-camera-*.test.ts owns these). Two independent
 * pieces, both driven by the live-scan loop on a 250ms interval:
 *
 *   1. same-code dedupe — a barcode held in frame decodes again on every
 *      tick, so a raw `onDetect` would fire repeatedly for one physical
 *      scan. `shouldEmitScannedCode` says whether THIS decode is new enough
 *      (different code, or the same code after the dedupe window lapsed).
 *   2. downscale-dimensions math — each frame is shrunk to at most
 *      CAMERA_SCAN_DOWNSCALE_MAX_WIDTH px wide (aspect-preserving) before
 *      JPEG-encoding it for the wasm decoder — the exact pipeline validated
 *      against real phone hardware (see camera-scanner.tsx's header).
 */

export const CAMERA_SCAN_DEDUPE_MS = 3000;
export const CAMERA_SCAN_DOWNSCALE_MAX_WIDTH = 1200;

export interface LastScannedCode {
  code: string;
  at: number;
}

/**
 * True when `code` is new enough to emit — false when it's a repeat decode
 * of the same code still within `dedupeMs` of the last emit.
 */
export function shouldEmitScannedCode(
  last: LastScannedCode | null,
  code: string,
  now: number,
  dedupeMs: number = CAMERA_SCAN_DEDUPE_MS,
): boolean {
  if (!last || code !== last.code) return true;
  return now - last.at >= dedupeMs;
}

export interface FrameDimensions {
  width: number;
  height: number;
}

/**
 * Aspect-preserving downscale target for a captured video frame. Never
 * upscales — a source already narrower than `maxWidth` is left as-is.
 */
export function computeDownscaleDimensions(
  videoWidth: number,
  videoHeight: number,
  maxWidth: number = CAMERA_SCAN_DOWNSCALE_MAX_WIDTH,
): FrameDimensions {
  const scale = Math.min(1, maxWidth / videoWidth);
  return {
    width: Math.round(videoWidth * scale),
    height: Math.round(videoHeight * scale),
  };
}
