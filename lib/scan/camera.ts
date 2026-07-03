/**
 * lib/scan/camera.ts — camera-based code scanning (FEATURES.md §5.5:
 * "camera (`BarcodeDetector`, html5-qrcode fallback)"; plan/tab-scan.md:
 * "camera scan via BarcodeDetector w/ html5-qrcode fallback, behind a
 * 'Camera' toggle, permission-safe").
 *
 * Client-only (uses `navigator.mediaDevices`, `window`) — never import from
 * a Server Component. Two backends, same public shape, chosen automatically:
 *   - native `BarcodeDetector` (Chrome/Android) — we own the `<video>` feed
 *     and poll `detect()` ourselves.
 *   - `html5-qrcode` fallback (Safari/iOS/Firefox, anywhere `BarcodeDetector`
 *     is absent) — it owns the camera + renders into a container div.
 *
 * "Permission-safe": every camera-acquiring call is wrapped so a denied/
 * unavailable camera surfaces through `onError` (toast in the UI) instead of
 * throwing past the caller — the scan page must keep working via the code
 * input either way.
 */

export type CameraBackend = "barcode-detector" | "html5-qrcode";

export interface CameraController {
  backend: CameraBackend;
  stop: () => Promise<void>;
}

export interface StartCameraScanOptions {
  /** `<video>` element the native BarcodeDetector backend streams into. Ignored by the html5-qrcode backend. */
  videoElement: HTMLVideoElement | null;
  /** DOM id of an empty container the html5-qrcode backend renders its own video/canvas into. */
  fallbackContainerId: string;
  onDetect: (code: string) => void;
  onError?: (error: Error) => void;
  /** Ignore a repeat detection of the same code within this many ms (a held-still camera re-reads every frame). Default 2000. */
  duplicateSuppressMs?: number;
}

/** True when the browser exposes a native `BarcodeDetector` (feature-detected, not UA-sniffed). */
export function isBarcodeDetectorSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function wrapsDuplicateSuppression(
  onDetect: (code: string) => void,
  suppressMs: number,
): (code: string) => void {
  let lastCode: string | null = null;
  let lastAt = 0;
  return (code: string) => {
    const now = Date.now();
    if (code === lastCode && now - lastAt < suppressMs) return;
    lastCode = code;
    lastAt = now;
    onDetect(code);
  };
}

/**
 * Native BarcodeDetector backend: acquires the rear camera, streams into
 * `videoElement`, and polls `detect()` on an interval.
 */
async function startBarcodeDetectorScan(options: StartCameraScanOptions): Promise<CameraController> {
  const { videoElement, onDetect, onError, duplicateSuppressMs = 2000 } = options;
  if (!videoElement) {
    throw new Error("startCameraScan: videoElement is required for the BarcodeDetector backend");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  videoElement.srcObject = stream;
  await videoElement.play();

  // BarcodeDetector isn't in every TS DOM lib version yet — narrow via the runtime check above.
  const Detector = (window as unknown as { BarcodeDetector: new (opts?: { formats: string[] }) => {
    detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
  } }).BarcodeDetector;
  const detector = new Detector({ formats: ["qr_code"] });
  const emit = wrapsDuplicateSuppression(onDetect, duplicateSuppressMs);

  let stopped = false;
  const pollMs = 220;
  const poll = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(videoElement);
      if (codes.length > 0) emit(codes[0]!.rawValue);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (!stopped) setTimeout(poll, pollMs);
    }
  };
  void poll();

  return {
    backend: "barcode-detector",
    stop: async () => {
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      videoElement.srcObject = null;
    },
  };
}

/** html5-qrcode fallback — the library owns camera acquisition + rendering into `fallbackContainerId`. */
async function startHtml5QrcodeScan(options: StartCameraScanOptions): Promise<CameraController> {
  const { fallbackContainerId, onDetect, onError, duplicateSuppressMs = 2000 } = options;
  const { Html5Qrcode } = await import("html5-qrcode");
  const scanner = new Html5Qrcode(fallbackContainerId);
  const emit = wrapsDuplicateSuppression(onDetect, duplicateSuppressMs);

  await scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 240 },
    (decodedText: string) => emit(decodedText),
    () => {
      // Per-frame "no code found" callback — expected on every frame without
      // a code in view, not an error worth surfacing.
    },
  );

  return {
    backend: "html5-qrcode",
    stop: async () => {
      try {
        await scanner.stop();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      scanner.clear();
    },
  };
}

/**
 * Starts camera scanning with the best available backend. Rejections from
 * camera acquisition (permission denied, no camera, insecure context) are
 * caught and rethrown as a plain `Error` with a friendly message — the
 * caller (the "Camera" toggle) should catch this and fall back to the code
 * input, not crash the page.
 */
export async function startCameraScan(options: StartCameraScanOptions): Promise<CameraController> {
  try {
    if (isBarcodeDetectorSupported()) {
      return await startBarcodeDetectorScan(options);
    }
    return await startHtml5QrcodeScan(options);
  } catch (error) {
    const message =
      error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
        ? "Camera permission was denied — allow camera access, or use the code input below."
        : `Could not start the camera: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(message);
  }
}
