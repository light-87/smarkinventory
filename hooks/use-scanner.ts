"use client";

/**
 * hooks/use-scanner.ts — wires the scan surface together: the focus-trapped
 * HID buffer (lib/scan/hid-buffer), code resolution (lib/scan/resolve), the
 * camera toggle (lib/scan/camera), the offline movement queue
 * (lib/scan/offline-queue), and the movement/undo write path
 * (lib/movements) into one hook `app/(app)/scan/page.tsx` + components/scan
 * consume.
 *
 * Not unit-tested directly (no React testing library is installed in this
 * repo — see this package's report) — every piece of DECISION logic it
 * calls into (`pushHidKey`/`checkHidAutoFlush`, `resolveScanCode`,
 * `recordMovement`/`undoMovement`, the offline-queue functions) is unit
 * tested on its own in tests/unit/scan-*.test.ts and
 * tests/invariants/{undo-pairing,qty-rollup}.test.ts.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import {
  checkHidAutoFlush,
  classifyScanCode,
  createInitialHidBufferState,
  DEFAULT_HID_BUFFER_OPTIONS,
  enqueueOfflineMovement,
  isNetworkError,
  listOfflineMovements,
  pushHidKey,
  resolveScanCode,
  startCameraScan,
  syncOfflineMovements,
  type CameraController,
  type HidBufferState,
  type ScanResolution,
} from "@/lib/scan";
import { recordScanMovementAction, undoScanMovementAction } from "@/lib/scan/actions";
import { MovementValidationError, sumLocationQty, type MovementInput } from "@/lib/movements";
import { formatNumber } from "@/lib/format";

export interface UseScannerResult {
  // ── code input ────────────────────────────────────────────────────────
  code: string;
  onCodeChange: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  clearCode: () => void;

  // ── resolution ────────────────────────────────────────────────────────
  resolution: ScanResolution | null;
  resolving: boolean;
  resolveError: string | null;
  closeResult: () => void;

  // ── camera ────────────────────────────────────────────────────────────
  cameraOn: boolean;
  cameraError: string | null;
  fallbackContainerId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  toggleCamera: () => void;

  // ── offline queue ─────────────────────────────────────────────────────
  queuedCount: number;

  // ── part-card actions (only meaningful when resolution.type === "part") ──
  step: number;
  setStep: (next: number) => void;
  selectedLocationId: string | null;
  selectLocation: (id: string) => void;
  takeOut: () => Promise<void>;
  addStock: () => Promise<void>;
  actionPending: boolean;
}

const MIN_STEP = 1;

function formatBoxLabel(name: string, shelfCode?: string | null): string {
  return shelfCode ? `Box ${name} · Shelf ${shelfCode}` : `Box ${name}`;
}

export interface UseScannerOptions {
  /**
   * FEATURES.md §2: accountant is read-only on Scan. UI half of the "enforced
   * twice" matrix — `app/(app)/scan/page.tsx` computes this server-side via
   * `getSessionUser()` + `canWrite(role, "scan")` and threads it down. The
   * write path ALSO pre-checks server-side (`lib/scan/actions.ts`), so a
   * caller that somehow still reaches `takeOut`/`addStock` gets a clear
   * message instead of an RLS-denied Postgres error. Defaults to `true` so
   * existing callers (none in this app) keep today's behavior.
   */
  canWrite?: boolean;
}

export function useScanner({ canWrite = true }: UseScannerOptions = {}): UseScannerResult {
  const supabase = useMemo(() => createClient(), []);
  const { push: pushToast } = useToast();
  const fallbackContainerId = `scan${useId().replace(/[^a-zA-Z0-9-]/g, "-")}camera`;

  const [code, setCode] = useState("");
  const [resolution, setResolution] = useState<ScanResolution | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);

  const [queuedCount, setQueuedCount] = useState(() => listOfflineMovements().length);

  const [step, setStepState] = useState(1);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const bufferRef = useRef<HidBufferState>(createInitialHidBufferState());
  const autoFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actorIdRef = useRef<string | null>(null);

  const refreshQueuedCount = useCallback(() => {
    setQueuedCount(listOfflineMovements().length);
  }, []);

  // Current actor (smark_app_users.id === auth.users.id) — best-effort.
  // lib/auth/session.ts's getSessionUser() is server-only (Server
  // Components/Actions, next/headers cookies) and can't be called from this
  // client hook, so this reads the browser-side Supabase auth session
  // directly instead — the client-side equivalent, not a stand-in for it.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) actorIdRef.current = data.user?.id ?? null;
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Best-effort sync whenever the browser comes back online (queued count
  // itself is seeded synchronously in useState above, not here — see
  // react-hooks/set-state-in-effect).
  useEffect(() => {
    const trySync = () => {
      void syncOfflineMovements(supabase).then(({ synced, dropped }) => {
        refreshQueuedCount();
        if (synced.length > 0) {
          pushToast({ msg: `Synced ${synced.length} queued movement${synced.length === 1 ? "" : "s"}` });
        }
        // Permanently-invalid queued movements (e.g. stock moved below a
        // queued take-out amount) — surfaced rather than silently vanishing.
        for (const item of dropped) {
          pushToast({ msg: `Could not sync "${item.summary}" — dropped from the queue` });
        }
      });
    };
    trySync();
    window.addEventListener("online", trySync);
    return () => window.removeEventListener("online", trySync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveCode = useCallback(
    async (rawCode: string) => {
      const shape = classifyScanCode(rawCode);
      if (shape === "empty") return;
      setResolving(true);
      setResolveError(null);
      try {
        const result = await resolveScanCode(supabase, rawCode);
        if (!result) {
          pushToast({ msg: `No match for "${rawCode.trim()}"` });
          setResolution(null);
          return;
        }
        setResolution(result);
        setStepState(1);
        setSelectedLocationId(result.type === "part" ? (result.data.locations[0]?.id ?? null) : null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not resolve that code";
        setResolveError(message);
        pushToast({ msg: message });
      } finally {
        setResolving(false);
      }
    },
    [supabase, pushToast],
  );

  const scheduleAutoFlush = useCallback(() => {
    if (autoFlushTimerRef.current) clearTimeout(autoFlushTimerRef.current);
    autoFlushTimerRef.current = setTimeout(() => {
      const { state, flushed } = checkHidAutoFlush(bufferRef.current, Date.now());
      bufferRef.current = state;
      if (flushed) {
        setCode("");
        void resolveCode(flushed);
      }
    }, DEFAULT_HID_BUFFER_OPTIONS.autoFlushGapMs + 20);
  }, [resolveCode]);

  const onCodeChange = useCallback(
    (value: string) => {
      const previous = code;
      const now = Date.now();
      if (value.length === previous.length + 1 && value.startsWith(previous)) {
        // Exactly one character appended — feed the burst detector so a
        // no-terminator HID scanner can still auto-flush.
        const appended = value.slice(-1);
        const { state } = pushHidKey(bufferRef.current, appended, now);
        bufferRef.current = state;
      } else {
        // Paste, multi-char autofill, mid-string edit, or a deletion — treat
        // as a fresh, non-burst buffer matching the actual input value.
        bufferRef.current = { buffer: value, lastCharAt: now, isBurst: false };
      }
      setCode(value);
      scheduleAutoFlush();
    },
    [code, scheduleAutoFlush],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (autoFlushTimerRef.current) clearTimeout(autoFlushTimerRef.current);
      bufferRef.current = createInitialHidBufferState();
      const current = code;
      setCode("");
      void resolveCode(current);
    },
    [code, resolveCode],
  );

  const clearCode = useCallback(() => {
    if (autoFlushTimerRef.current) clearTimeout(autoFlushTimerRef.current);
    bufferRef.current = createInitialHidBufferState();
    setCode("");
  }, []);

  const closeResult = useCallback(() => {
    setResolution(null);
    setResolveError(null);
    setStepState(1);
    setSelectedLocationId(null);
  }, []);

  // ── camera ──────────────────────────────────────────────────────────────
  const toggleCamera = useCallback(() => {
    if (cameraOn) {
      void cameraControllerRef.current?.stop();
      cameraControllerRef.current = null;
      setCameraOn(false);
      return;
    }
    setCameraError(null);
    void startCameraScan({
      videoElement: videoRef.current,
      fallbackContainerId,
      onDetect: (detectedCode) => void resolveCode(detectedCode),
      onError: (error) => setCameraError(error.message),
    })
      .then((controller) => {
        cameraControllerRef.current = controller;
        setCameraOn(true);
      })
      .catch((error: unknown) => {
        setCameraError(error instanceof Error ? error.message : "Could not start the camera");
        setCameraOn(false);
      });
  }, [cameraOn, fallbackContainerId, resolveCode]);

  useEffect(() => {
    return () => {
      void cameraControllerRef.current?.stop();
    };
  }, []);

  const setStep = useCallback((next: number) => {
    setStepState(Math.max(MIN_STEP, Math.round(next)));
  }, []);

  const selectLocation = useCallback((id: string) => {
    setSelectedLocationId(id);
  }, []);

  // ── take-out / add ────────────────────────────────────────────────────
  const applyMovement = useCallback(
    async (sign: 1 | -1) => {
      if (!resolution || resolution.type !== "part") return;
      if (!canWrite) {
        pushToast({ msg: "You don't have permission to make changes on Scan" });
        return;
      }
      const location = resolution.data.locations.find((loc) => loc.id === selectedLocationId) ?? resolution.data.locations[0];
      if (!location) {
        pushToast({ msg: "This part has no stock location to update" });
        return;
      }
      const actor = actorIdRef.current;
      if (!actor) {
        pushToast({ msg: "Sign in to record stock movements" });
        return;
      }

      const part = resolution.data.part;
      const deltaQty = sign * step;
      const input: MovementInput = {
        locationId: location.id,
        partId: part.id,
        bigBoxId: location.big_box_id,
        deltaQty,
        reason: "adjust",
        actor,
      };
      const boxLabel = formatBoxLabel(location.big_box?.name ?? location.big_box_id, location.big_box?.shelf?.code);
      const summary =
        sign === 1
          ? `Added ${formatNumber(step)} × ${part.internal_pid} to ${boxLabel}`
          : `Took out ${formatNumber(step)} × ${part.internal_pid} from ${boxLabel}`;

      setActionPending(true);
      try {
        const { movement, location: updatedLocation } = await recordScanMovementAction(input);
        setResolution((prev) => {
          if (!prev || prev.type !== "part") return prev;
          const nextLocations = prev.data.locations.map((loc) =>
            loc.id === updatedLocation.id ? { ...loc, qty: updatedLocation.qty } : loc,
          );
          return {
            type: "part",
            data: { part: { ...prev.data.part, total_qty: sumLocationQty(nextLocations) }, locations: nextLocations },
          };
        });
        pushToast({
          msg: summary,
          undo: true,
          onUndo: () => {
            void undoScanMovementAction(movement.id)
              .then(({ location: reversedLocation }) => {
                if (!reversedLocation) return;
                setResolution((prev) => {
                  if (!prev || prev.type !== "part") return prev;
                  const nextLocations = prev.data.locations.map((loc) =>
                    loc.id === reversedLocation.id ? { ...loc, qty: reversedLocation.qty } : loc,
                  );
                  return {
                    type: "part",
                    data: {
                      part: { ...prev.data.part, total_qty: sumLocationQty(nextLocations) },
                      locations: nextLocations,
                    },
                  };
                });
              })
              .catch((error: unknown) => {
                pushToast({ msg: error instanceof Error ? error.message : "Could not undo that movement" });
              });
          },
        });
      } catch (error) {
        if (error instanceof MovementValidationError) {
          pushToast({ msg: error.message });
        } else if (isNetworkError(error)) {
          enqueueOfflineMovement(input, summary);
          refreshQueuedCount();
          pushToast({ msg: `Offline — queued: ${summary}` });
        } else {
          pushToast({ msg: error instanceof Error ? error.message : "Could not record that movement" });
        }
      } finally {
        setActionPending(false);
        setStepState(1);
      }
    },
    [resolution, selectedLocationId, step, canWrite, pushToast, refreshQueuedCount],
  );

  const takeOut = useCallback(() => applyMovement(-1), [applyMovement]);
  const addStock = useCallback(() => applyMovement(1), [applyMovement]);

  return {
    code,
    onCodeChange,
    onKeyDown,
    clearCode,
    resolution,
    resolving,
    resolveError,
    closeResult,
    cameraOn,
    cameraError,
    fallbackContainerId,
    videoRef,
    toggleCamera,
    queuedCount,
    step,
    setStep,
    selectedLocationId,
    selectLocation,
    takeOut,
    addStock,
    actionPending,
  };
}
