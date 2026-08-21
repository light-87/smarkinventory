/**
 * What a printed label says, per category (lib/labels/content.ts).
 *
 * The client's spec, 2026-08-21:
 *   Resistor  → Value, Package, Voltage, Power, Part No.
 *   Capacitor → Value, Package, Voltage, Power, Part No.
 *   IC        → MPN, Description, Part No.
 *
 * Every part in these tests is a real row copied out of the production
 * catalogue, so a passing test means the rule holds against the data the client
 * is actually printing rather than a tidied-up fixture.
 */

import { describe, expect, test } from "bun:test";
import { boxLabelLines, fieldsForCategory, partLabelLines } from "@/lib/labels/content";

describe("partLabelLines — resistor", () => {
  const resistor = {
    internal_pid: "SMK-001477",
    mpn: "ERJ-HP6F1001V",
    value: "1 kΩ",
    package: "0805",
    voltage: "400",
    description: "RES 1kΩ ±1% 500mW 0805",
    category: "Resistor",
    attributes: { power_watts: "500mW", tolerance_percent: 1 },
  };

  test("carries value, package, voltage, power and the part number", () => {
    expect(partLabelLines(resistor)).toEqual(["SMK-001477", "1 kΩ · 0805", "400V · 500mW"]);
  });

  test("adds the unit to a bare voltage — the import stores resistors' as a plain number", () => {
    expect(partLabelLines(resistor)[2]).toStartWith("400V");
  });

  test("reads a numeric power rating as watts", () => {
    const lines = partLabelLines({ ...resistor, attributes: { power_watts: 0.125 } });
    expect(lines[2]).toBe("400V · 0.125W");
  });

  test("drops a rating the part does not have instead of printing a blank", () => {
    const lines = partLabelLines({ ...resistor, voltage: null, attributes: {} });
    expect(lines).toEqual(["SMK-001477", "1 kΩ · 0805"]);
  });
});

describe("partLabelLines — capacitor", () => {
  test("prints value · package then voltage (no power rating in the source data)", () => {
    const lines = partLabelLines({
      internal_pid: "SMK-000001",
      mpn: null,
      value: "100 nF",
      package: "0402",
      voltage: "50V",
      description: "0.1uF/100nF",
      category: "Capacitor",
      attributes: { capacitance_farads: 1e-7 },
    });
    expect(lines).toEqual(["SMK-000001", "100 nF · 0402", "50V"]);
  });
});

describe("partLabelLines — IC", () => {
  test("prints MPN and description, which is all an IC row has", () => {
    const lines = partLabelLines({
      internal_pid: "SMK-000863",
      mpn: "LM555CMX/NOPB",
      value: null,
      package: null,
      voltage: null,
      description: "IC OSC SGL TIMER 100KHZ 8-SOIC",
      category: "IC",
      attributes: { mount_type: "SMD" },
    });
    expect(lines).toEqual(["SMK-000863", "LM555CMX/NOPB", "IC OSC SGL TIMER 100KHZ 8-SOIC"]);
  });

  test("an IC with a package still does not print it — the client's list for IC is MPN + description", () => {
    const lines = partLabelLines({
      internal_pid: "SMK-000669",
      mpn: "AO3400-HXY",
      package: "SOT-23",
      description: "MOSFET N-CH 30V 5.8A SOT-23",
      category: "IC",
    });
    expect(lines).toEqual(["SMK-000669", "AO3400-HXY", "MOSFET N-CH 30V 5.8A SOT-23"]);
  });
});

describe("partLabelLines — categories with no rule of their own", () => {
  test("a connector keeps its description, which used to be dropped entirely", () => {
    // SMK-001754 printed "SMK-001754" and the single character "2" before this
    // change: `value` was "2" at queue time and nothing else was a candidate.
    const lines = partLabelLines({
      internal_pid: "SMK-001754",
      mpn: null,
      value: null,
      package: null,
      description: "2Pin 5.08mm Male Connector",
      category: "Connector",
      attributes: { pitch: "5.08mm", pin_count: "2 Pin" },
    });
    expect(lines).toEqual(["SMK-001754", "2Pin 5.08mm Male Connector"]);
  });

  test("an inductor keeps value · package", () => {
    const lines = partLabelLines({
      internal_pid: "SMK-000974",
      mpn: "SRN4018BTA-2R2M",
      value: "2.2 µH",
      package: "4x4x1.6mm",
      category: "Inductor",
    });
    expect(lines).toEqual(["SMK-000974", "SRN4018BTA-2R2M", "2.2 µH · 4x4x1.6mm"]);
  });

  test("an uncategorized part still gets a label rather than a bare PID", () => {
    const lines = partLabelLines({ internal_pid: "SMK-000500", value: "10 kΩ", package: "0603", category: null });
    expect(lines).toEqual(["SMK-000500", "10 kΩ · 0603"]);
  });

  test("a part with nothing filled in falls back to its part number alone", () => {
    expect(partLabelLines({ internal_pid: "SMK-000777" })).toEqual(["SMK-000777"]);
  });
});

describe("fieldsForCategory", () => {
  test("the three categories the client specified get their own field list", () => {
    expect(fieldsForCategory("Resistor")).toEqual(["value", "package", "voltage", "power"]);
    expect(fieldsForCategory("IC")).toEqual(["mpn", "description"]);
  });

  test("anything else falls back to the union", () => {
    expect(fieldsForCategory("Relay")).toContain("description");
    expect(fieldsForCategory(null)).toContain("description");
  });
});

describe("boxLabelLines", () => {
  test("one fact per line — the joined single line is what got cut to 'BOX Conne…'", () => {
    expect(boxLabelLines({ name: "C-04", category: "Capacitors", shelfCode: "B" })).toEqual([
      "BOX C-04",
      "Capacitors",
      "Shelf B",
    ]);
  });

  test("omits a category the box name already says", () => {
    expect(boxLabelLines({ name: "Resistor 1206", category: "Resistor", shelfCode: "U" })).toEqual([
      "BOX Resistor 1206",
      "Shelf U",
    ]);
  });

  test("omits a missing category", () => {
    expect(boxLabelLines({ name: "A-01", category: null, shelfCode: "A" })).toEqual(["BOX A-01", "Shelf A"]);
  });
});
