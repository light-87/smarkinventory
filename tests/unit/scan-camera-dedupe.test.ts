import { describe, expect, test } from "bun:test";
import { CAMERA_SCAN_DEDUPE_MS, shouldEmitScannedCode, type LastScannedCode } from "@/lib/scan/camera-frame";

/**
 * lib/scan/camera-frame — shouldEmitScannedCode. The live-scan loop
 * (components/scan/camera-scanner.tsx) re-decodes a barcode held in frame on
 * every ~250ms tick; this predicate is what stops that from re-emitting the
 * SAME code over and over for one physical scan.
 */

describe("camera-frame: shouldEmitScannedCode", () => {
  test("emits the very first code (no prior detection)", () => {
    expect(shouldEmitScannedCode(null, "SMK-000101", 1_000)).toBe(true);
  });

  test("suppresses an immediate repeat of the same code (barcode held in frame)", () => {
    const last: LastScannedCode = { code: "SMK-000101", at: 1_000 };
    expect(shouldEmitScannedCode(last, "SMK-000101", 1_050)).toBe(false);
  });

  test("suppresses the same code up to (but not including) the dedupe window", () => {
    const last: LastScannedCode = { code: "SMK-000101", at: 1_000 };
    expect(shouldEmitScannedCode(last, "SMK-000101", 1_000 + CAMERA_SCAN_DEDUPE_MS - 1)).toBe(false);
  });

  test("re-emits the same code once the dedupe window has fully elapsed", () => {
    const last: LastScannedCode = { code: "SMK-000101", at: 1_000 };
    expect(shouldEmitScannedCode(last, "SMK-000101", 1_000 + CAMERA_SCAN_DEDUPE_MS)).toBe(true);
  });

  test("a DIFFERENT code emits immediately even inside the dedupe window", () => {
    const last: LastScannedCode = { code: "SMK-000101", at: 1_000 };
    expect(shouldEmitScannedCode(last, "SMK-000202", 1_050)).toBe(true);
  });

  test("respects a custom dedupeMs override", () => {
    const last: LastScannedCode = { code: "X", at: 1_000 };
    expect(shouldEmitScannedCode(last, "X", 1_600, 500)).toBe(true);
    expect(shouldEmitScannedCode(last, "X", 1_600, 1000)).toBe(false);
  });
});
