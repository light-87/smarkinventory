import { describe, expect, test } from "bun:test";
import { derivePackageFromFootprint, splitValueVoltage } from "@/lib/bom/footprint";

describe("derivePackageFromFootprint", () => {
  test("strips a KiCad library prefix and finds a bare SMD size", () => {
    expect(derivePackageFromFootprint("SMARKKicadLib:C0805")).toBe("0805");
    expect(derivePackageFromFootprint("SMARKKicadLib:R0603")).toBe("0603");
  });

  test("finds a named package family", () => {
    expect(derivePackageFromFootprint("Package_TO_SOT_SMD:SOT-23")).toBe("SOT-23");
    expect(derivePackageFromFootprint("SomeLib:LQFP-48_7x7mm")).toBe("LQFP-48");
  });

  test("returns null for a footprint with no recognizable package token", () => {
    expect(derivePackageFromFootprint("SMARKKicadLib:CAP_AE_10x10.5")).toBeNull();
  });

  test("null/empty input returns null", () => {
    expect(derivePackageFromFootprint(null)).toBeNull();
    expect(derivePackageFromFootprint("")).toBeNull();
  });
});

describe("splitValueVoltage", () => {
  test("splits a combined value/voltage cell on the slash", () => {
    expect(splitValueVoltage("220uF/50V")).toEqual({ value: "220uF", voltage: "50V" });
  });

  test("a plain value with no slash passes through with a null voltage", () => {
    expect(splitValueVoltage("4.7k")).toEqual({ value: "4.7k", voltage: null });
  });

  test("null/blank input yields nulls both ways", () => {
    expect(splitValueVoltage(null)).toEqual({ value: null, voltage: null });
    expect(splitValueVoltage("   ")).toEqual({ value: null, voltage: null });
  });
});
