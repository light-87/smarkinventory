import { describe, expect, test } from "bun:test";
import { CAMERA_SCAN_DOWNSCALE_MAX_WIDTH, computeDownscaleDimensions } from "@/lib/scan/camera-frame";

/**
 * lib/scan/camera-frame — computeDownscaleDimensions. Each captured video
 * frame is shrunk to at most CAMERA_SCAN_DOWNSCALE_MAX_WIDTH px wide
 * (aspect-preserving) before JPEG-encoding it for the wasm decoder — this is
 * the exact math the real-hardware-validated reference pipeline uses
 * (components/scan/camera-scanner.tsx).
 */

describe("camera-frame: computeDownscaleDimensions", () => {
  test("shrinks a wide frame down to the max width, preserving aspect ratio", () => {
    const { width, height } = computeDownscaleDimensions(1920, 1080);
    expect(width).toBe(CAMERA_SCAN_DOWNSCALE_MAX_WIDTH);
    expect(height).toBe(Math.round(1080 * (CAMERA_SCAN_DOWNSCALE_MAX_WIDTH / 1920)));
  });

  test("never upscales a frame already narrower than the max width", () => {
    const { width, height } = computeDownscaleDimensions(640, 480);
    expect(width).toBe(640);
    expect(height).toBe(480);
  });

  test("leaves a frame exactly at the max width unchanged", () => {
    const { width, height } = computeDownscaleDimensions(CAMERA_SCAN_DOWNSCALE_MAX_WIDTH, 675);
    expect(width).toBe(CAMERA_SCAN_DOWNSCALE_MAX_WIDTH);
    expect(height).toBe(675);
  });

  test("respects a custom maxWidth override", () => {
    const { width, height } = computeDownscaleDimensions(2000, 1000, 800);
    expect(width).toBe(800);
    expect(height).toBe(400);
  });

  test("rounds fractional pixel dimensions", () => {
    const { width, height } = computeDownscaleDimensions(1201, 900);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(width).toBe(1200);
    expect(height).toBe(Math.round(900 * (1200 / 1201)));
  });
});
