import { describe, expect, test } from "bun:test";
import {
  checkHidAutoFlush,
  createInitialHidBufferState,
  DEFAULT_HID_BUFFER_OPTIONS,
  pushHidKey,
} from "@/lib/scan/hid-buffer";

/**
 * lib/scan/hid-buffer — the focus-trapped debounced keystroke buffer
 * (FEATURES.md §5.5, plan/tab-scan.md). Pure state machine, fed fabricated
 * timestamps so timing behaviour is deterministic (no real timers).
 */

function typeString(text: string, startAt: number, gapMs: number) {
  let state = createInitialHidBufferState();
  let now = startAt;
  for (const char of text) {
    ({ state } = pushHidKey(state, char, now));
    now += gapMs;
  }
  return { state, endAt: now };
}

describe("hid-buffer: pushHidKey", () => {
  test("accumulates printable characters into the buffer", () => {
    const { state } = typeString("SMK-000101", 0, 500); // human-cadence gaps
    expect(state.buffer).toBe("SMK-000101");
  });

  test("Enter flushes the buffer and resets state", () => {
    let state = createInitialHidBufferState();
    ({ state } = pushHidKey(state, "S", 0));
    ({ state } = pushHidKey(state, "M", 10));
    const step = pushHidKey(state, "Enter", 20);
    expect(step.flushed).toBe("SM");
    expect(step.state).toEqual(createInitialHidBufferState());
  });

  test("Enter on an empty buffer flushes nothing", () => {
    const step = pushHidKey(createInitialHidBufferState(), "Enter", 0);
    expect(step.flushed).toBeNull();
    expect(step.state.buffer).toBe("");
  });

  test("Backspace removes the last character without flushing", () => {
    let state = createInitialHidBufferState();
    ({ state } = pushHidKey(state, "A", 0));
    ({ state } = pushHidKey(state, "B", 10));
    const step = pushHidKey(state, "Backspace", 20);
    expect(step.flushed).toBeNull();
    expect(step.state.buffer).toBe("A");
  });

  test("Backspace on an empty buffer is a no-op", () => {
    const state = createInitialHidBufferState();
    const step = pushHidKey(state, "Backspace", 0);
    expect(step.state).toBe(state);
  });

  test("non-printable / modifier keys (Shift, Tab, ArrowLeft) are ignored", () => {
    let state = createInitialHidBufferState();
    ({ state } = pushHidKey(state, "A", 0));
    for (const key of ["Shift", "Tab", "ArrowLeft", "Control", "CapsLock"]) {
      const step = pushHidKey(state, key, 10);
      expect(step.flushed).toBeNull();
      expect(step.state.buffer).toBe("A");
    }
  });

  test("a long pause after existing buffered text starts a fresh buffer (stale scan discarded)", () => {
    let state = createInitialHidBufferState();
    ({ state } = pushHidKey(state, "X", 0));
    // A stray leftover char, then a real new scan begins much later.
    const staleGap = DEFAULT_HID_BUFFER_OPTIONS.staleGapMs + 500;
    ({ state } = pushHidKey(state, "S", staleGap));
    expect(state.buffer).toBe("S"); // "X" was discarded, not "XS"
  });
});

describe("hid-buffer: burst classification + auto-flush", () => {
  test("every gap under burstGapMs keeps isBurst true (machine-speed typing)", () => {
    const { state } = typeString("SMK001", 0, DEFAULT_HID_BUFFER_OPTIONS.burstGapMs - 5);
    expect(state.isBurst).toBe(true);
  });

  test("a single human-cadence gap flips isBurst to false and stays false", () => {
    let state = createInitialHidBufferState();
    ({ state } = pushHidKey(state, "S", 0));
    ({ state } = pushHidKey(state, "M", DEFAULT_HID_BUFFER_OPTIONS.burstGapMs - 5)); // fast
    ({ state } = pushHidKey(state, "K", DEFAULT_HID_BUFFER_OPTIONS.burstGapMs + 200)); // slow — human
    expect(state.isBurst).toBe(false);
    ({ state } = pushHidKey(state, "-", DEFAULT_HID_BUFFER_OPTIONS.burstGapMs + 205)); // fast again, but already downgraded
    expect(state.isBurst).toBe(false);
  });

  test("checkHidAutoFlush flushes a burst-typed buffer after a quiet gap with no terminator", () => {
    const { state, endAt } = typeString("SMK001", 0, DEFAULT_HID_BUFFER_OPTIONS.burstGapMs - 5);
    const quietNow = endAt + DEFAULT_HID_BUFFER_OPTIONS.autoFlushGapMs + 1;
    const step = checkHidAutoFlush(state, quietNow);
    expect(step.flushed).toBe("SMK001");
    expect(step.state).toEqual(createInitialHidBufferState());
  });

  test("checkHidAutoFlush never fires for human-cadence typing (no terminator required, but also no surprise submit)", () => {
    const { state, endAt } = typeString("SMK001", 0, 300); // human cadence throughout
    const quietNow = endAt + DEFAULT_HID_BUFFER_OPTIONS.autoFlushGapMs + 1;
    const step = checkHidAutoFlush(state, quietNow);
    expect(step.flushed).toBeNull();
    expect(step.state).toBe(state);
  });

  test("checkHidAutoFlush is a no-op before the quiet gap has elapsed", () => {
    const { state } = typeString("SMK001", 0, DEFAULT_HID_BUFFER_OPTIONS.burstGapMs - 5);
    const tooSoon = state.lastCharAt! + DEFAULT_HID_BUFFER_OPTIONS.autoFlushGapMs - 10;
    const step = checkHidAutoFlush(state, tooSoon);
    expect(step.flushed).toBeNull();
  });

  test("checkHidAutoFlush on an empty buffer is always a no-op", () => {
    const step = checkHidAutoFlush(createInitialHidBufferState(), 10_000);
    expect(step.flushed).toBeNull();
  });
});
