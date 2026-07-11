"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { CameraIcon, CloseIcon, EditIcon, TorchIcon } from "@/components/scan/icons";
import {
  computeDownscaleDimensions,
  shouldEmitScannedCode,
  type LastScannedCode,
} from "@/lib/scan/camera-frame";

/**
 * components/scan/camera-scanner.tsx — full-screen live camera scanner,
 * ported from a client-validated reference (real phone hardware) rather than
 * built from scratch. Each video frame is downscaled (lib/scan/camera-frame),
 * JPEG-encoded, and decoded with zxing-wasm — the pipeline that reads real
 * barcodes reliably on a phone. Point the camera at a code and it auto-
 * detects within a moment; no tap needed. Stays "dumb" about parts/boxes —
 * the caller (hooks/use-scanner.ts) resolves the emitted code. In
 * `continuous` mode the camera keeps scanning after a hit (SmarkStock's
 * take-out/add-in loop scans many parts in a row); otherwise it closes after
 * the first code.
 *
 * Formats are left unrestricted (no `formats` filter on `readBarcodes`) —
 * SmarkStock's own ESD/Big-Box labels are QR, but incoming distributor
 * packaging carries 1D barcodes the same camera needs to read.
 */

const DEDUPE_MS = 3000; // ignore the SAME code for 3s so a held barcode isn't re-added every frame

// Lazy-load + fully instantiate the wasm reader, pointed at the self-hosted .wasm.
let zxingPromise: Promise<typeof import("zxing-wasm/reader")> | null = null;
function loadZxing() {
  if (!zxingPromise) {
    zxingPromise = import("zxing-wasm/reader").then(async (m) => {
      await m.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) =>
            path.endsWith(".wasm") ? "/zxing/zxing_reader.wasm" : (prefix || "") + path,
        },
        fireImmediately: true,
      });
      return m;
    });
  }
  return zxingPromise;
}

type ErrKind = "denied" | "nocam" | "insecure" | "loadfail" | null;

const ERROR_MESSAGES: Record<Exclude<ErrKind, null>, string> = {
  denied: "Camera permission was denied — allow camera access, or type the code below.",
  insecure: "Camera needs a secure (https) connection — type the code below.",
  nocam: "No camera found on this device — type the code below.",
  loadfail: "Scanner could not load — type the code below.",
};

export interface CameraScannerProps {
  open: boolean;
  onClose: () => void;
  onDetect: (code: string) => void;
  /** Keep scanning after a hit instead of closing (default: false). */
  continuous?: boolean;
  title?: string;
  statusLine?: string;
}

export function CameraScanner({
  open,
  onClose,
  onDetect,
  continuous = false,
  title,
  statusLine,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRef = useRef<LastScannedCode | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [errKind, setErrKind] = useState<ErrKind>(null);
  const [manual, setManual] = useState(false);
  const [manualVal, setManualVal] = useState("");
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [flash, setFlash] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const s = streamRef.current;
    if (s) {
      for (const track of s.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.srcObject = null;
      } catch {
        /* detached element */
      }
    }
  }, []);

  function beep() {
    try {
      let ctx = audioRef.current;
      if (!ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        audioRef.current = ctx;
      }
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      const tone = (freq: number, start: number, dur: number, peak: number) => {
        const o = ctx!.createOscillator();
        const g = ctx!.createGain();
        o.type = "triangle";
        o.frequency.value = freq;
        o.connect(g);
        g.connect(ctx!.destination);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.start(start);
        o.stop(start + dur + 0.02);
      };
      tone(740, now, 0.14, 0.6);
      tone(1110, now + 0.13, 0.24, 0.65);
    } catch {
      /* AudioContext unavailable — vibration/flash still confirm the hit */
    }
  }

  const handleCode = useCallback(
    (raw: string) => {
      const code = (raw || "").trim();
      if (!code) return;
      const now = Date.now();
      if (!shouldEmitScannedCode(lastRef.current, code, now, DEDUPE_MS)) return;
      lastRef.current = { code, at: now };
      try {
        navigator.vibrate?.([35, 30, 60]);
      } catch {
        /* vibration unsupported */
      }
      beep();
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 280);
      onDetectRef.current(code);
      if (!continuous) {
        stop();
        onCloseRef.current();
      }
    },
    [continuous, stop],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErrKind(null);
    setManual(false);
    setManualVal("");
    setHasTorch(false);
    setTorchOn(false);
    setEngineLoading(false);
    lastRef.current = null;

    async function start() {
      const host = window.location.hostname;
      const localish = host === "localhost" || host === "127.0.0.1";
      if (!window.isSecureContext && !localish) {
        setErrKind("insecure");
        setManual(true);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrKind("nocam");
        setManual(true);
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          if (!cancelled) {
            setErrKind("denied");
            setManual(true);
          }
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          if (!cancelled) {
            setErrKind("nocam");
            setManual(true);
          }
          return;
        }
      }
      if (cancelled || !stream) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* autoplay rejected — track still delivers frames once user-gestured */
        }
      }

      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() as Record<string, unknown> | undefined) ?? {};
      if (caps && "torch" in caps) setHasTorch(true);

      // load + instantiate the decoder, then start the live loop
      setEngineLoading(true);
      let zx: Awaited<ReturnType<typeof loadZxing>> | null = null;
      try {
        zx = await loadZxing();
      } catch {
        if (!cancelled) {
          setErrKind("loadfail");
          setManual(true);
        }
      }
      if (!cancelled) setEngineLoading(false);
      if (!zx || cancelled) return;

      const canvas = document.createElement("canvas");
      const cctx = canvas.getContext("2d");
      let busy = false;
      intervalRef.current = setInterval(async () => {
        if (busy || !cctx) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        busy = true;
        try {
          const { width, height } = computeDownscaleDimensions(v.videoWidth, v.videoHeight);
          canvas.width = width;
          canvas.height = height;
          cctx.drawImage(v, 0, 0, width, height);
          const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.85));
          if (blob) {
            const r = await zx!.readBarcodes(blob, { maxNumberOfSymbols: 1 });
            const hit = r[0];
            if (hit?.text) handleCode(hit.text);
          }
        } catch {
          /* frame decode error — keep scanning */
        } finally {
          busy = false;
        }
      }, 250);
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, handleCode, stop]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      setTorchOn((v) => !v);
    } catch {
      /* torch constraint rejected — button stays visible, just a no-op tap */
    }
  }

  function close() {
    stop();
    onCloseRef.current();
  }

  function submitManual() {
    const v = manualVal.trim();
    if (!v) return;
    setManualVal("");
    onDetectRef.current(v);
    if (!continuous) close();
  }

  if (!open) return null;

  const errMsg = errKind ? ERROR_MESSAGES[errKind] : "";
  const statusText = engineLoading
    ? "Loading scanner…"
    : (statusLine ?? "Point the camera at an ESD-plastic or Big-Box QR");

  // Portal to <body>: the header (components/shell/header.tsx) has a
  // backdrop-filter, which makes it the containing block for any fixed-position
  // descendant. Rendered inline, this full-screen overlay would be trapped
  // inside the 60px header instead of covering the viewport. The portal escapes
  // that stacking/containing context so `fixed inset-0` means the whole screen.
  return createPortal(
    <div className="fixed inset-0 z-[75] flex flex-col bg-black">
      {/* header */}
      <div
        className="absolute inset-x-0 top-0 z-[3] flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3.5 pb-2.5"
        style={{ paddingTop: "calc(14px + env(safe-area-inset-top))" }}
      >
        <div className="truncate text-[16px] font-medium text-white">{title ?? "Scan a code"}</div>
        <div className="flex flex-none gap-2">
          {hasTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label="Torch"
              aria-pressed={torchOn}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl transition-colors",
                torchOn ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25",
              )}
            >
              <TorchIcon className="size-5" />
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
      </div>

      {/* video */}
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full bg-black object-cover" />

      {/* reticle + status */}
      {!errKind && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={cn(
              "h-[140px] w-[80%] max-w-[340px] rounded-2xl border-[3px] shadow-[0_0_0_2000px_rgba(0,0,0,0.3)] transition-colors duration-150",
              flash ? "border-phosphor-green" : "border-white/90",
            )}
          />
          <div className="mt-4 max-w-[88%] rounded-full bg-black/55 px-4 py-[7px] text-center text-[14.5px] font-medium text-white">
            {statusText}
          </div>
        </div>
      )}

      {/* error card */}
      {errKind && (
        <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center px-7 text-center">
          <CameraIcon className="mb-3.5 size-12 text-white/60" />
          <div className="max-w-[300px] text-[16px] leading-relaxed font-medium text-white">{errMsg}</div>
        </div>
      )}

      {/* bottom bar: manual entry */}
      <div
        className="absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/70 to-transparent px-4 pt-3.5"
        style={{ paddingBottom: "calc(22px + env(safe-area-inset-bottom))" }}
      >
        {manual ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              mono
              uiSize="lg"
              value={manualVal}
              onChange={(e) => setManualVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitManual()}
              placeholder="Type the code…"
              aria-label="Manual code entry"
              className="flex-1 border-white/25 bg-white/12 text-[16px] text-white placeholder:text-white/50 focus:border-smark-orange"
            />
            <Button size="lg" onClick={submitManual}>
              Use
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="lg"
            fullWidth
            icon={<EditIcon />}
            onClick={() => setManual(true)}
            className="border-white/25 bg-white/12 text-white hover:bg-white/20"
          >
            Enter code manually
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
