/**
 * lib/scan/hid-buffer.ts — the focus-trapped, debounced keystroke buffer
 * (plan/tab-scan.md: "HID = focus-trapped debounced keystroke buffer ending
 * in Enter"; FEATURES.md §5.5).
 *
 * A USB/Bluetooth HID barcode scanner is, to the browser, just a very fast
 * keyboard that (almost always, but not guaranteed) finishes each scan with
 * an Enter/CR keystroke. This module is a pure state machine — no DOM, no
 * timers — so it's directly unit-testable with fabricated timestamps
 * (tests/unit/scan-hid-buffer.test.ts); `hooks/use-scanner.ts` is the only
 * caller that wires it to real `keydown` events + a timer.
 *
 * Two jobs:
 *   1. Accumulate keystrokes into one code, flushing on Enter (the common,
 *      well-behaved-scanner case — and identical to how a human typing into
 *      the input + pressing Enter resolves, per the prototype).
 *   2. Recognize a genuinely machine-speed burst (every gap under
 *      `burstGapMs`) and auto-flush it after a short quiet gap even with NO
 *      terminator key — covers scanners configured without a CR suffix.
 *      Human typing (which always has at least one slower gap) never
 *      triggers this path, so a person mid-typing a PID is never
 *      interrupted by an unwanted auto-submit.
 *
 * The input showing the live code should be driven BY `state.buffer` (single
 * source of truth) rather than kept as separate React state — see
 * `hooks/use-scanner.ts`.
 */

export interface HidBufferState {
  buffer: string;
  lastCharAt: number | null;
  /** True while every gap seen so far in the current buffer has been burst-speed. */
  isBurst: boolean;
}

export interface HidBufferOptions {
  /** Inter-keystroke gap (ms) below which a keystroke counts as machine-speed. Default 30. */
  burstGapMs?: number;
  /** Gap (ms) at/after which a non-empty buffer is treated as abandoned and reset before accepting the new key. Default 1500. */
  staleGapMs?: number;
  /** Quiet time (ms) after the last burst keystroke before auto-flushing without a terminator. Default 120. */
  autoFlushGapMs?: number;
}

export const DEFAULT_HID_BUFFER_OPTIONS: Required<HidBufferOptions> = {
  burstGapMs: 30,
  staleGapMs: 1500,
  autoFlushGapMs: 120,
};

export function createInitialHidBufferState(): HidBufferState {
  return { buffer: "", lastCharAt: null, isBurst: false };
}

export interface HidBufferStep {
  state: HidBufferState;
  /** Non-null exactly when a complete code was just flushed. */
  flushed: string | null;
}

/**
 * Feeds one keystroke into the buffer. `key` is a DOM `KeyboardEvent.key`
 * value — single printable characters accumulate, `"Enter"` flushes,
 * `"Backspace"` corrects a manual mis-type, everything else (Shift, Tab,
 * arrow keys, ...) is ignored.
 */
export function pushHidKey(
  state: HidBufferState,
  key: string,
  now: number,
  options: HidBufferOptions = {},
): HidBufferStep {
  const { burstGapMs, staleGapMs } = { ...DEFAULT_HID_BUFFER_OPTIONS, ...options };

  if (key === "Enter") {
    const code = state.buffer;
    return { state: createInitialHidBufferState(), flushed: code === "" ? null : code };
  }

  if (key === "Backspace") {
    if (state.buffer === "") return { state, flushed: null };
    return {
      state: { buffer: state.buffer.slice(0, -1), lastCharAt: now, isBurst: false },
      flushed: null,
    };
  }

  if (key.length !== 1) {
    // Non-printable / modifier key — doesn't participate in the code.
    return { state, flushed: null };
  }

  const gap = state.lastCharAt === null ? Infinity : now - state.lastCharAt;
  const isStale = gap >= staleGapMs && state.buffer !== "";
  const buffer = isStale ? key : state.buffer + key;
  // First character of a fresh buffer is tentatively "burst" until a second
  // keystroke proves the cadence one way or the other.
  const isBurst = isStale || state.buffer === "" ? true : state.isBurst && gap <= burstGapMs;

  return { state: { buffer, lastCharAt: now, isBurst }, flushed: null };
}

/**
 * Call periodically (e.g. on a timer re-armed after every `pushHidKey`) to
 * detect a burst-typed buffer that's gone quiet without a terminator key.
 * Never auto-flushes human-cadence typing — only a buffer where every gap
 * so far has been machine-speed.
 */
export function checkHidAutoFlush(state: HidBufferState, now: number, options: HidBufferOptions = {}): HidBufferStep {
  const { autoFlushGapMs } = { ...DEFAULT_HID_BUFFER_OPTIONS, ...options };
  if (state.buffer === "" || state.lastCharAt === null || !state.isBurst) {
    return { state, flushed: null };
  }
  if (now - state.lastCharAt < autoFlushGapMs) {
    return { state, flushed: null };
  }
  return { state: createInitialHidBufferState(), flushed: state.buffer };
}
