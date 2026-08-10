import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  attributeKeyFor,
  collectDuplicateMpns,
  FILE_CATEGORY,
  parseCsv,
  parseCsvRecords,
  parseFormattedCsvFile,
  parseFormattedCsvFolder,
  parseQty,
  provenanceKeyOf,
  summarizeDataFlags,
} from "@/lib/import/formatted-csv";

/**
 * lib/import/formatted-csv.ts — real-fixture tests.
 *
 * The fixture is the client's 2026-08-10 `Formatted Output` drop, copied
 * verbatim. Every count below was captured from those exact files, not
 * guessed — they double as the acceptance figures the client verifies against,
 * so a change here means either a parser bug or a new drop from the client.
 */

const FIXTURE_DIR = resolve(__dirname, "../fixtures/formatted-output");

describe("parseCsv — RFC 4180, no coercion", () => {
  test("splits plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("strips the UTF-8 BOM the client's files carry", () => {
    // The BOM is what keeps Ω/µ/℃ intact in Excel; it must not end up glued
    // to the first header name, which would break every column lookup.
    expect(parseCsv("﻿Mount_Type,Value\nSMD,4.7 kΩ")[0]).toEqual(["Mount_Type", "Value"]);
  });

  test("keeps commas and doubled quotes inside quoted fields", () => {
    expect(parseCsv('MPN,Voltage\nRelay,"7A,250V AC"')[1]).toEqual(["Relay", "7A,250V AC"]);
    expect(parseCsv('a\n"say ""hi"""')[1]).toEqual(['say "hi"']);
  });

  test("handles CRLF endings and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("never coerces — leading-zero package codes survive as written", () => {
    // A spreadsheet parser turns 0603 into the number 603. That silent damage
    // is the whole reason this reader exists.
    const [, row] = parseCsv("Package\n0603");
    expect(row).toEqual(["0603"]);
    expect(typeof row![0]).toBe("string");
  });
});

describe("parseCsvRecords", () => {
  test("keys cells by header and trims", () => {
    expect(parseCsvRecords("MPN, Qty_In_Stock\n 1N4007 ,91")).toEqual([{ MPN: "1N4007", Qty_In_Stock: "91" }]);
  });

  test("drops trailing blank lines rather than emitting empty parts", () => {
    expect(parseCsvRecords("MPN\n1N4007\n\n")).toHaveLength(1);
  });
});

describe("parseQty", () => {
  test("plain integers", () => {
    expect(parseQty("255")).toEqual({ qty: 255, raw: null, flag: null });
    expect(parseQty("0")).toEqual({ qty: 0, raw: null, flag: null });
  });

  test("blank is unknown, not zero", () => {
    expect(parseQty("")).toEqual({ qty: null, raw: null, flag: "qty_missing" });
    expect(parseQty(undefined)).toEqual({ qty: null, raw: null, flag: "qty_missing" });
  });

  test("text quantities keep the leading count AND the original wording", () => {
    expect(parseQty("16 strip")).toEqual({ qty: 16, raw: "16 strip", flag: "qty_unparsed" });
    expect(parseQty("180/10")).toEqual({ qty: 180, raw: "180/10", flag: "qty_unparsed" });
    expect(parseQty("3 + 5 SAMPLE")).toEqual({ qty: 3, raw: "3 + 5 SAMPLE", flag: "qty_unparsed" });
    expect(parseQty("50Mtr")).toEqual({ qty: 50, raw: "50Mtr", flag: "qty_unparsed" });
  });

  test("text with no leading digit yields no count rather than a guessed 0", () => {
    expect(parseQty("2desolder")).toEqual({ qty: 2, raw: "2desolder", flag: "qty_unparsed" });
    expect(parseQty("out of stock")).toEqual({ qty: null, raw: "out of stock", flag: "qty_unparsed" });
  });
});

describe("attributeKeyFor", () => {
  test("snake-cases CSV headers", () => {
    expect(attributeKeyFor("Contact_Type")).toBe("contact_type");
    expect(attributeKeyFor("SP_MOQ100")).toBe("sp_moq100");
    expect(attributeKeyFor("Group")).toBe("group");
  });
});

describe("parseFormattedCsvFile — mapping", () => {
  test("a capacitor row maps onto the right typed columns", () => {
    const [part] = parseFormattedCsvFile(
      "capacitors.csv",
      "Mount_Type,Capacitance_Farads,Value_Display,Voltage_Rating,Tolerance_Percent,Package,Color,Manufacturer,MPN,Description,Distributor,LCSC_Part,Qty_In_Stock,Source_Sheet,Source_Row\n" +
        "SMD,1e-07,100 nF,50V,,0402 (1005 Metric),,,,,LCSC,C105882,255,S4-Cap,5",
    );

    expect(part).toMatchObject({
      category: "Capacitor",
      value: "100 nF",
      voltage: "50V",
      package: "0402 (1005 Metric)",
      mpn: null,
      lcsc_pn: "C105882",
      distributor: "LCSC",
      qty: 255,
      source_sheet: "S4-Cap",
      source_row: 5,
    });
    // The machine-readable number is kept for the range filters that come
    // next, alongside the already-formatted display string.
    expect(part!.attributes.capacitance_farads).toBe(1e-7);
    expect(part!.attributes.mount_type).toBe("SMD");
    // Blank cells never become "" or 0 — they simply aren't there.
    expect(part!.attributes.color).toBeUndefined();
    expect(part!.attributes.tolerance_percent).toBeUndefined();
  });

  test("`Type` and `Sub_Category` both land on one attribute key", () => {
    const [connector] = parseFormattedCsvFile(
      "connectors.csv",
      "Type,MPN,Package,Description,Distributor,LCSC_Part,Qty_In_Stock,Source_Sheet,Source_Row\n" +
        "Automotive Fuse Holder,3557-02-01,3.4x13.5mm,,Element14,,0,S10-Connectors1,6",
    );
    expect(connector!.attributes.sub_category).toBe("Automotive Fuse Holder");

    const [ic] = parseFormattedCsvFile(
      "ic_smd.csv",
      "Sub_Category,MPN,Description,Manufacturer,Package,Project,Distributor,LCSC_Part,Qty_In_Stock,Source_Sheet,Source_Row\n" +
        "ADC,AD7684BRMZ,IC ADC 16BIT SAR 8MSOP,,MSOP8,,ANALOG DEVICES,,1,S2-SMD IC,5",
    );
    expect(ic!.attributes.sub_category).toBe("ADC");
    expect(ic!.description).toBe("IC ADC 16BIT SAR 8MSOP");
    expect(ic!.attributes.mount_type).toBe("SMD");
  });

  test("files with no Value_Display take their human name from the right column", () => {
    const [module] = parseFormattedCsvFile(
      "modules.csv",
      "Module_Name,MPN,Description,Distributor,LCSC_Part,Qty_In_Stock,Source_Sheet,Source_Row\n" +
        "1A CHARGING MODULE,18650,,,,1,S7-SMD Modules,5",
    );
    expect(module!.value).toBe("1A CHARGING MODULE");
    expect(module!.mpn).toBe("18650");
  });

  test("a file-level fact never overwrites what the row itself said", () => {
    // resistors.csv carries a real Mount_Type column, so nothing is inferred.
    const [resistor] = parseFormattedCsvFile(
      "resistors.csv",
      "Mount_Type,MPN,Resistance_Ohms,Value_Display,Tolerance_Percent,Power_Watts,Package,PPM,Description,Distributor,LCSC_Part,Qty_In_Stock,Source_Sheet,Source_Row\n" +
        "TH,,4700,4.7 kΩ,1,0.25,Axial,,,RS,,40,S3-Res,5",
    );
    expect(resistor!.attributes.mount_type).toBe("TH");
    expect(resistor!.attributes.resistance_ohms).toBe(4700);
    expect(resistor!.attributes.tolerance_percent).toBe(1);
    // PPM is blank throughout the source — not worth a jsonb key.
    expect(resistor!.attributes.ppm).toBeUndefined();
  });

  test("rows with no identifier are flagged, never dropped or given a fake MPN", () => {
    const [bare] = parseFormattedCsvFile(
      "resistors.csv",
      "Mount_Type,MPN,Resistance_Ohms,Value_Display,Tolerance_Percent,Power_Watts,Package,PPM,Description,Distributor,LCSC_Part,Qty_In_Stock,Source_Sheet,Source_Row\n" +
        "SMD,,,,,,0603 (1608 Metric),,,,,2850,S3-Res,7",
    );
    expect(bare!.mpn).toBeNull();
    expect(bare!.dataFlags).toEqual(["no_identity", "unidentifiable"]);
    expect(bare!.attributes.data_flag).toBe("no_identity,unidentifiable");
    expect(bare!.qty).toBe(2850);
  });

  test("an unknown filename is a hard error, not a silent skip", () => {
    expect(() => parseFormattedCsvFile("thermocouples.csv", "MPN\nK-TYPE")).toThrow(/Unknown stock CSV/);
  });
});

describe("the real client fixture", () => {
  const result = parseFormattedCsvFolder(FIXTURE_DIR);

  test("imports 1,999 stock rows from 31 files", () => {
    expect(result.fileSummary).toHaveLength(31);
    expect(result.parts).toHaveLength(1999);
  });

  test("skips the manifest, the guide and stencils", () => {
    expect(result.skippedFiles.map((s) => s.file).sort()).toEqual([
      "Import_Guide.md",
      "category_index.csv",
      "stencils.csv",
    ]);
  });

  test("per-file counts match the client's own category_index.csv", () => {
    const counts = Object.fromEntries(result.fileSummary.map((f) => [f.file, f.rowCount]));
    expect(counts).toMatchObject({
      "resistors.csv": 450,
      "capacitors.csv": 275,
      "ic_smd.csv": 505,
      "connectors.csv": 176,
      "diodes.csv": 136,
      "inductors.csv": 86,
      "modules.csv": 54,
      "ffc_fpc_connectors.csv": 51,
      "ic_th.csv": 32,
      "misc_led.csv": 32,
      "misc_switch.csv": 30,
      "material_list.csv": 28,
      "misc_fuse.csv": 23,
      "spring_terminal_blocks.csv": 21,
      "misc_crystal.csv": 17,
      "cable_assemblies.csv": 12,
      "misc_thermistor_varistor.csv": 10,
      "smps.csv": 10,
      "dev_kits.csv": 8,
      "misc_transformer.csv": 8,
      "misc_relay.csv": 7,
      "misc_oled_display.csv": 5,
      "misc_battery.csv": 4,
      "misc_rocker_switch.csv": 4,
      "voltage_protector.csv": 4,
      "misc_ir.csv": 3,
      "discrete_semiconductors_th.csv": 2,
      "misc_current_transformer.csv": 2,
      "misc_lcd_display.csv": 2,
      "misc_dcdc_converter.csv": 1,
      "misc_photosensor.csv": 1,
    });
  });

  test("every row gets a category, and they are all mapped values", () => {
    const allowed = new Set(Object.values(FILE_CATEGORY));
    for (const part of result.parts) {
      expect(allowed.has(part.category)).toBe(true);
    }
    // 31 files collapse to 28 categories: ic_smd+ic_th → IC, misc_switch +
    // misc_rocker_switch → Switch, misc_lcd+misc_oled → Display.
    expect(new Set(result.parts.map((p) => p.category)).size).toBe(28);
  });

  test("data-quality flags match the counts reported to the client", () => {
    expect(summarizeDataFlags(result.parts)).toEqual({
      no_identity: 484,
      qty_unparsed: 17,
      qty_missing: 50,
      unidentifiable: 265,
    });
  });

  test("1,855 rows carry a usable positive quantity", () => {
    // 1,838 plain numbers plus the 17 text quantities, each of which still
    // yields a leading count ("16 strip" → 16). 94 rows are a genuine 0 and
    // 50 are blank.
    expect(result.parts.filter((p) => (p.qty ?? 0) > 0)).toHaveLength(1855);
  });

  test("repeated MPNs are reported for a human call, not merged away", () => {
    // 38 collisions, and only 22 of them sit inside a single file — the rest
    // are the same part number typed into two different sheets. Exactly the
    // case that makes MPN the wrong dedupe key for this import.
    const duplicates = collectDuplicateMpns(result.parts);
    expect(duplicates).toHaveLength(38);
    // XY-128 is the archetype: the same part number on the 2-pin and the
    // 3-pin green connector. Merging them would lose a real distinction.
    const xy128 = duplicates.find((d) => d.mpn === "XY-128");
    expect(xy128?.occurrences).toHaveLength(2);
  });

  test("the provenance key is unique across all 1,999 rows", () => {
    // The import's idempotency rests entirely on this. Both simpler keys are
    // genuinely ambiguous in this drop, which is why all three parts are used:
    //   sheet#row  — 64 collisions (side-by-side tables share row numbers)
    //   file|row   — 43 collisions (connectors.csv merges two sheets)
    const keys = result.parts.map((p) => provenanceKeyOf(p.source_file, p.source_sheet, p.source_row));
    expect(keys.filter((k) => k === null)).toHaveLength(0);
    expect(new Set(keys).size).toBe(1999);
  });

  test("the two simpler keys really do collide — this is why the full key exists", () => {
    const sheetRow = result.parts.map((p) => `${p.source_sheet}#${p.source_row}`);
    expect(new Set(sheetRow).size).toBe(1999 - 64);

    const fileRow = result.parts.map((p) => `${p.source_file}|${p.source_row}`);
    expect(new Set(fileRow).size).toBe(1999 - 43);
  });

  test("every row carries its source file for that key to be rebuildable from the DB", () => {
    for (const part of result.parts) {
      expect(part.attributes.source_file).toBe(part.source_file);
      expect(typeof part.attributes.source_row).toBe("number");
    }
  });

  test("a known row round-trips exactly as the client wrote it", () => {
    const cap = result.parts.find((p) => p.lcsc_pn === "C105882");
    expect(cap).toMatchObject({
      category: "Capacitor",
      value: "100 nF",
      voltage: "50V",
      package: "0402 (1005 Metric)",
      distributor: "LCSC",
      qty: 255,
      source_sheet: "S4-Cap",
    });
  });
});
