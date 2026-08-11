import { describe, expect, test } from "bun:test";
import { buildPartEdit, type PartEditInput } from "@/lib/part-events/edit";
import { joinDistributor, splitDistributor } from "@/lib/part-events/distributor";
import { buildPartSpecs } from "@/lib/part-events/specs";
import type { PartAttributes, PartRow } from "@/types/db";

/**
 * Editing an imported part, and what the part detail is allowed to show.
 *
 * Both come from the client's 2026-08-11 pass over the freshly imported
 * catalog: "How can I edit the uploaded part - like description or any other
 * value", and a screenshot with Source Row and Source File circled: "these
 * should be removed".
 */

function makePart(overrides: Partial<PartRow> = {}): PartRow {
  return {
    id: "part-1",
    created_at: "2026-08-11T00:00:00Z",
    updated_at: null,
    internal_pid: "SMK-000013",
    mpn: null,
    manufacturer: null,
    lcsc_pn: "C105882",
    description: "0.1uF/100nF",
    category: "Capacitor",
    value: "100 nF",
    package: "0402 (1005 Metric)",
    voltage: "50V",
    part_status: "active",
    datasheet_url: null,
    default_distributor: "LCSC",
    attributes: { mount_type: "SMD", capacitance_farads: 1e-7, source_file: "capacitors.csv", source_row: 5 } as PartAttributes,
    total_qty: 255,
    reorder_point: null,
    source_sheet: "S4-Cap",
    needs_review: true,
    last_unit_price: null,
    currency: "INR",
    created_by: null,
    ...overrides,
  };
}

/** The dialog always submits every box, pre-filled from the part. */
function inputFor(part: PartRow, overrides: Partial<PartEditInput> = {}): PartEditInput {
  return {
    partId: part.id,
    fields: {
      mpn: part.mpn ?? "",
      manufacturer: part.manufacturer ?? "",
      lcsc_pn: part.lcsc_pn ?? "",
      description: part.description ?? "",
      value: part.value ?? "",
      voltage: part.voltage ?? "",
      package: part.package ?? "",
      category: part.category ?? "",
    },
    attributes: { sub_category: "", mount_type: String(part.attributes.mount_type ?? "") },
    reorderPoint: part.reorder_point === null ? "" : String(part.reorder_point),
    status: part.part_status,
    distributor: splitDistributor(part.default_distributor),
    ...overrides,
  };
}

describe("buildPartEdit", () => {
  test("submitting the form untouched changes nothing", () => {
    const part = makePart();
    const built = buildPartEdit(part, inputFor(part));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.result.changes).toEqual([]);
    expect(built.result.patch).toEqual({});
  });

  test("edits only the fields that actually moved", () => {
    const part = makePart();
    const input = inputFor(part);
    input.fields.description = "100nF 50V X7R";

    const built = buildPartEdit(part, input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.result.patch)).toEqual(["description"]);
    expect(built.result.changes).toEqual(["Description: 0.1uF/100nF → 100nF 50V X7R"]);
  });

  test("an empty box clears the value rather than being ignored", () => {
    // "Delete this wrong description" has to be expressible; treating blank as
    // "no change" would make a bad value permanent.
    const part = makePart();
    const input = inputFor(part);
    input.fields.description = "   ";

    const built = buildPartEdit(part, input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.result.patch.description).toBeNull();
    expect(built.result.changes).toEqual(["Description: 0.1uF/100nF → —"]);
  });

  test("clearing an attribute removes the key instead of storing null", () => {
    // A null would still count as a value and contribute an empty facet option.
    const part = makePart();
    const input = inputFor(part);
    input.attributes.mount_type = "";

    const built = buildPartEdit(part, input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.result.patch.attributes).toBeDefined();
    expect("mount_type" in built.result.patch.attributes!).toBe(false);
    // Untouched attributes survive — including the ones the form never shows.
    expect(built.result.patch.attributes!.source_file).toBe("capacitors.csv");
  });

  test("setting a new attribute keeps the others intact", () => {
    const part = makePart();
    const input = inputFor(part);
    input.attributes.sub_category = "MLCC";

    const built = buildPartEdit(part, input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.result.patch.attributes!.sub_category).toBe("MLCC");
    expect(built.result.patch.attributes!.mount_type).toBe("SMD");
  });

  test("reorder point accepts a whole number, blank, and rejects the rest", () => {
    const part = makePart();

    const set = buildPartEdit(part, inputFor(part, { reorderPoint: "50" }));
    expect(set.ok && set.result.patch.reorder_point).toBe(50);

    const cleared = buildPartEdit(makePart({ reorder_point: 50 }), inputFor(makePart({ reorder_point: 50 }), { reorderPoint: "" }));
    expect(cleared.ok && cleared.result.patch.reorder_point).toBeNull();

    expect(buildPartEdit(part, inputFor(part, { reorderPoint: "-1" }))).toEqual({
      ok: false,
      error: "Reorder point must be a whole number, 0 or more.",
    });
    expect(buildPartEdit(part, inputFor(part, { reorderPoint: "2.5" })).ok).toBe(false);
  });

  test("status moves through the enum and nothing else", () => {
    const part = makePart();
    const ok = buildPartEdit(part, inputFor(part, { status: "eol" }));
    expect(ok.ok && ok.result.patch.part_status).toBe("eol");

    const bad = buildPartEdit(part, inputFor(part, { status: "retired" as never }));
    expect(bad).toEqual({ ok: false, error: "Unknown part status." });
  });

  test("several edits at once are all described for the living record", () => {
    const part = makePart();
    const input = inputFor(part);
    input.fields.mpn = "CL05B104KO5NNNC";
    input.fields.value = "0.1 µF";
    input.attributes.sub_category = "MLCC";

    const built = buildPartEdit(part, input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.result.changes).toHaveLength(3);
    expect(built.result.changes).toContain("MPN: — → CL05B104KO5NNNC");
  });
});

describe("distributor", () => {
  test("a known distributor opens on its own option, not Other", () => {
    expect(splitDistributor("LCSC")).toEqual({ choice: "LCSC", other: "" });
    // Case differences must not fall through to Other and create a duplicate.
    expect(splitDistributor("digikey")).toEqual({ choice: "Digikey", other: "" });
  });

  test("an imported value outside the list opens as Other, preserved", () => {
    // The sheet holds RS, Arrow, Robu, China and worse. None are rewritten.
    expect(splitDistributor("RS")).toEqual({ choice: "Other", other: "RS" });
    expect(joinDistributor({ choice: "Other", other: "RS" })).toBe("RS");
  });

  test("blank means not set, both ways", () => {
    expect(splitDistributor(null)).toEqual({ choice: "", other: "" });
    expect(joinDistributor({ choice: "", other: "" })).toBeNull();
    // Choosing Other and typing nothing clears rather than storing "Other".
    expect(joinDistributor({ choice: "Other", other: "  " })).toBeNull();
  });

  test("changing the distributor is patched and described", () => {
    const part = makePart({ default_distributor: "RS" });
    const built = buildPartEdit(part, inputFor(part, { distributor: { choice: "Mouser", other: "" } }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.result.patch.default_distributor).toBe("Mouser");
    expect(built.result.changes).toContain("Distributor: RS → Mouser");
  });

  test("reopening and saving an Other distributor untouched changes nothing", () => {
    const part = makePart({ default_distributor: "Robu" });
    const built = buildPartEdit(part, inputFor(part));
    expect(built.ok && built.result.changes).toEqual([]);
  });
});

describe("the Specifications grid hides internal fields", () => {
  const specs = buildPartSpecs(makePart());
  const labels = specs.map((s) => s.label);

  test("provenance and QA keys never render", () => {
    // Filter_Specification.md §1: internal traceability only, "do not expose
    // them as filters or as visible fields".
    for (const hidden of ["Source File", "Source Row", "Source Sheet", "Data Flag", "Qty Raw"]) {
      expect(labels).not.toContain(hidden);
    }
  });

  test("the raw base-unit number does not sit next to its readable form", () => {
    // Import_Guide.md §2 calls 0.0000001 unreadable and says to display
    // Value_Display instead — which is already the "Value" row.
    expect(labels).not.toContain("Capacitance Farads");
    expect(specs.find((s) => s.label === "Value")?.value).toBe("100 nF");
  });

  test("the real specs still render, including description", () => {
    expect(labels).toContain("Description");
    expect(labels).toContain("Package");
    expect(labels).toContain("Mount type");
    expect(specs.find((s) => s.label === "Description")?.value).toBe("0.1uF/100nF");
  });

  test("distributor is on the part page", () => {
    // "It should be visible on Part page. It gives us idea from where we
    // sourced that item."
    expect(specs.find((s) => s.label === "Distributor")?.value).toBe("LCSC");
  });
});

describe("empty core fields still render, so gaps are visible", () => {
  // "Empty fields are just not shown at all on part page… this way I am unable
  // to add details that are not already in it."
  const bare = buildPartSpecs(makePart({ mpn: null, manufacturer: null, voltage: null, default_distributor: null }));
  const labels = bare.map((s) => s.label);

  test("a part with no MPN, manufacturer, voltage or distributor still shows those rows", () => {
    for (const label of ["MPN", "Manufacturer", "Voltage", "Distributor"]) {
      expect(labels).toContain(label);
      expect(bare.find((s) => s.label === label)?.value).toBe("—");
    }
  });

  test("a populated field is not duplicated by its blank placeholder", () => {
    const full = buildPartSpecs(makePart()).map((s) => s.label);
    expect(full.filter((l) => l === "Description")).toHaveLength(1);
    expect(full.filter((l) => l === "Distributor")).toHaveLength(1);
  });

  test("price rows stay last", () => {
    expect(labels.slice(-2)).toEqual(["Last price", "Stock value"]);
  });

  test("the long tail of attributes is not forced when empty", () => {
    // Only the core set gets a blank row; a resistor does not sprout a dozen
    // empty IC columns.
    expect(labels).not.toContain("Diode type");
    expect(labels).not.toContain("Cost price (₹)");
  });
});
