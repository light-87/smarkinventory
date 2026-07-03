/**
 * tests/fixtures/canonical-seed-data.ts — the CANONICAL demo dataset.
 *
 * Ported verbatim from `SmarkStock-prototype/SmarkStock.dc.html`'s
 * `buildMock()` hand-picked fixture parts (the first 15 pushed before its
 * random generators fill the catalog to ~70) — plan/TESTING.md §4: "the
 * prototype's mock dataset... promoted to canonical fixtures — tests and
 * demos share one truth." Every value below (MPN, LCSC C-number, quantities,
 * prices, dates) is copied from the prototype's source, not invented, so
 * this is the SAME demo data a human reviewer already saw and approved.
 *
 * Shape: 4 shelves (A–D) → 9 big boxes → the SMK-000101 family (15 parts)
 * with real locations + a priced receive/pick history. Consumed by
 * `scripts/seed-canonical-demo.ts` (writes it to Supabase) — kept here,
 * not there, so `tests/unit/*` can import the same plain data for
 * assertions without touching a database.
 *
 * Dates are anchored to 2026 (the prototype's month/day labels had no year)
 * so every event lands in the past relative to "today" across the whole
 * demo window (Jan–Jun).
 */

export interface CanonicalShelf {
  code: string;
  name: string;
}

export interface CanonicalBigBox {
  code: string;
  shelfCode: string;
  name: string;
  category: string;
}

export interface CanonicalLocation {
  bigBoxCode: string;
  qty: number;
  lastCountedAt: string; // YYYY-MM-DD
}

export interface CanonicalHistoryEvent {
  kind: "received" | "picked";
  occurredAt: string; // YYYY-MM-DD
  /** Signed — picked events are already negative, matching smark_movements.delta_qty. */
  qty: number;
  distributor?: string;
  reason?: string;
  /** ₹ per unit; null when the prototype recorded no price (e.g. in-house builds). */
  unitPrice: number | null;
}

export interface CanonicalPart {
  internal_pid: string;
  category: string;
  value: string;
  voltage: string | null;
  package: string | null;
  mpn: string;
  lcsc_pn: string | null;
  manufacturer: string;
  part_status: "active" | "nrnd" | "eol";
  reorder_point: number;
  /** Long-tail facets the prototype tracked (dielectric, tolerance, current, watt...). */
  attributes: Record<string, string | number | boolean | null>;
  locations: CanonicalLocation[];
  history: CanonicalHistoryEvent[];
}

export const CANONICAL_SHELVES: CanonicalShelf[] = [
  { code: "A", name: "Passives" },
  { code: "B", name: "Passives / Caps" },
  { code: "C", name: "ICs & Modules" },
  { code: "D", name: "Power & Connectors" },
];

export const CANONICAL_BIG_BOXES: CanonicalBigBox[] = [
  { code: "A-03", shelfCode: "A", name: "Resistors 0402/0603", category: "Resistor" },
  { code: "A-07", shelfCode: "A", name: "Resistors & Inductors", category: "Inductor" },
  { code: "B-05", shelfCode: "B", name: "Capacitors (bulk)", category: "Capacitor" },
  { code: "B-12", shelfCode: "B", name: "Capacitors 0603", category: "Capacitor" },
  { code: "C-01", shelfCode: "C", name: "ADC / DAC ICs", category: "IC / ADC" },
  { code: "C-04", shelfCode: "C", name: "Data-converter ICs", category: "IC / DAC" },
  { code: "C-09", shelfCode: "C", name: "Modules & Sensors", category: "Module" },
  { code: "D-02", shelfCode: "D", name: "Power / SMPS", category: "SMPS" },
  { code: "D-06", shelfCode: "D", name: "Connectors", category: "Connector" },
];

export const CANONICAL_PARTS: CanonicalPart[] = [
  {
    internal_pid: "SMK-000101",
    category: "Capacitor",
    value: "0.1µF",
    voltage: "50V",
    package: "0603",
    mpn: "CL10B104MB8NNNC",
    lcsc_pn: "C14663",
    manufacturer: "Samsung",
    part_status: "active",
    reorder_point: 500,
    attributes: { dielectric: "X7R" },
    locations: [
      { bigBoxCode: "B-12", qty: 2568, lastCountedAt: "2026-06-20" },
      { bigBoxCode: "B-05", qty: 400, lastCountedAt: "2026-05-12" },
    ],
    history: [
      { kind: "received", occurredAt: "2026-05-12", qty: 2000, distributor: "LCSC", reason: "BOM order", unitPrice: 0.42 },
      { kind: "picked", occurredAt: "2026-06-01", qty: -145, reason: "pick", unitPrice: null },
      {
        kind: "received",
        occurredAt: "2026-06-20",
        qty: 713,
        distributor: "LCSC",
        reason: "top-up (existing box, no reprint)",
        unitPrice: 0.4,
      },
    ],
  },
  {
    internal_pid: "SMK-000102",
    category: "Capacitor",
    value: "10µF",
    voltage: "35V",
    package: "1206",
    mpn: "GRM319R6YA106KA12D",
    lcsc_pn: "C92797",
    manufacturer: "Murata",
    part_status: "active",
    reorder_point: 200,
    attributes: { dielectric: "X5R" },
    locations: [{ bigBoxCode: "B-12", qty: 480, lastCountedAt: "2026-06-18" }],
    history: [
      { kind: "received", occurredAt: "2026-05-05", qty: 600, distributor: "LCSC", unitPrice: 1.1 },
      { kind: "picked", occurredAt: "2026-06-02", qty: -120, unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000103",
    category: "Capacitor",
    value: "100µF",
    voltage: "63V",
    package: "CAP-AE",
    mpn: "PCM1J101MCL1GS",
    lcsc_pn: null,
    manufacturer: "Nichicon",
    part_status: "active",
    reorder_point: 25,
    attributes: {},
    locations: [{ bigBoxCode: "B-05", qty: 22, lastCountedAt: "2026-06-19" }],
    history: [
      { kind: "received", occurredAt: "2026-04-28", qty: 100, distributor: "Digikey", unitPrice: 24.8 },
      { kind: "picked", occurredAt: "2026-06-15", qty: -78, unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000104",
    category: "Capacitor",
    value: "4.7nF",
    voltage: null,
    package: "0603",
    mpn: "C0603C472F5GACAUTO",
    lcsc_pn: null,
    manufacturer: "KEMET",
    part_status: "active",
    reorder_point: 50,
    attributes: { dielectric: "C0G" },
    locations: [{ bigBoxCode: "B-05", qty: 0, lastCountedAt: "2026-06-19" }],
    history: [
      { kind: "received", occurredAt: "2026-04-01", qty: 500, distributor: "Mouser", unitPrice: 0.9 },
      { kind: "picked", occurredAt: "2026-06-10", qty: -500, unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000201",
    category: "Resistor",
    value: "0R",
    voltage: null,
    package: "0402",
    mpn: "RC0402JR-070RL",
    lcsc_pn: "C25086",
    manufacturer: "Yageo",
    part_status: "active",
    reorder_point: 100,
    attributes: { watt: "0.0625W" },
    locations: [{ bigBoxCode: "A-03", qty: 145, lastCountedAt: "2026-06-17" }],
    history: [{ kind: "received", occurredAt: "2026-03-20", qty: 1000, distributor: "LCSC", unitPrice: 0.05 }],
  },
  {
    internal_pid: "SMK-000202",
    category: "Resistor",
    value: "0.01R",
    voltage: null,
    package: "1206",
    mpn: "LVT12R0100FER",
    lcsc_pn: null,
    manufacturer: "Vishay",
    part_status: "active",
    reorder_point: 20,
    attributes: { watt: "1W", tolerance: "1%", current_sense: "10mΩ" },
    locations: [{ bigBoxCode: "A-07", qty: 60, lastCountedAt: "2026-06-16" }],
    history: [{ kind: "received", occurredAt: "2026-04-11", qty: 200, distributor: "Digikey", unitPrice: 6.4 }],
  },
  {
    internal_pid: "SMK-000301",
    category: "IC",
    value: "16BIT SAR",
    voltage: null,
    package: "MSOP8",
    mpn: "AD7684BRMZ",
    lcsc_pn: null,
    manufacturer: "Analog Devices",
    part_status: "nrnd",
    reorder_point: 2,
    attributes: { subcategory: "IC / ADC" },
    locations: [{ bigBoxCode: "C-01", qty: 1, lastCountedAt: "2026-06-14" }],
    history: [
      { kind: "received", occurredAt: "2026-02-02", qty: 5, distributor: "Mouser", unitPrice: 520 },
      { kind: "picked", occurredAt: "2026-05-20", qty: -4, unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000302",
    category: "IC",
    value: "24BIT ΣΔ",
    voltage: null,
    package: "32LQFP",
    mpn: "ADS124S08IPBSR",
    lcsc_pn: "C2870171",
    manufacturer: "Texas Instruments",
    part_status: "active",
    reorder_point: 5,
    attributes: { subcategory: "IC / ADC" },
    locations: [{ bigBoxCode: "C-04", qty: 12, lastCountedAt: "2026-06-18" }],
    history: [{ kind: "received", occurredAt: "2026-06-13", qty: 12, distributor: "LCSC", unitPrice: 412 }],
  },
  {
    internal_pid: "SMK-000303",
    category: "IC",
    value: "12BIT V-OUT",
    voltage: null,
    package: "SOT-23-6",
    mpn: "MCP4725A0T-E/CH",
    lcsc_pn: "C144198",
    manufacturer: "Microchip",
    part_status: "active",
    reorder_point: 5,
    attributes: { subcategory: "IC / DAC" },
    locations: [{ bigBoxCode: "C-04", qty: 5, lastCountedAt: "2026-06-18" }],
    history: [
      { kind: "received", occurredAt: "2026-05-30", qty: 20, distributor: "LCSC", unitPrice: 96 },
      { kind: "picked", occurredAt: "2026-06-12", qty: -15, unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000401",
    category: "Inductor",
    value: "2.2µH",
    voltage: null,
    package: "0805",
    mpn: "CB2012T2R2M",
    lcsc_pn: "C90311",
    manufacturer: "Taiyo Yuden",
    part_status: "active",
    reorder_point: 40,
    attributes: { current: "410mA" },
    locations: [{ bigBoxCode: "A-07", qty: 108, lastCountedAt: "2026-06-16" }],
    history: [{ kind: "received", occurredAt: "2026-06-19", qty: 150, distributor: "LCSC", unitPrice: 1.9 }],
  },
  {
    internal_pid: "SMK-000501",
    category: "Module",
    value: "3-axis compass",
    voltage: null,
    package: null,
    mpn: "HMC5883L",
    lcsc_pn: null,
    manufacturer: "Honeywell",
    part_status: "eol",
    reorder_point: 1,
    attributes: {},
    locations: [{ bigBoxCode: "C-09", qty: 1, lastCountedAt: "2026-06-10" }],
    history: [{ kind: "received", occurredAt: "2026-01-15", qty: 3, distributor: "Unikey", unitPrice: 210 }],
  },
  {
    internal_pid: "SMK-000601",
    category: "SMPS",
    value: "5V / 700mA (3W)",
    voltage: null,
    package: "30×20.5mm",
    mpn: "SPS-3W5-5V",
    lcsc_pn: null,
    manufacturer: "Smark",
    part_status: "active",
    reorder_point: 50,
    attributes: {},
    locations: [{ bigBoxCode: "D-02", qty: 182, lastCountedAt: "2026-06-11" }],
    history: [
      { kind: "received", occurredAt: "2026-06-11", qty: 50, reason: "built in-house", unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000602",
    category: "SMPS",
    value: "12V / 1A (12W)",
    voltage: null,
    package: "35×25mm",
    mpn: "SPS-12W-12V",
    lcsc_pn: null,
    manufacturer: "Smark",
    part_status: "active",
    reorder_point: 20,
    attributes: {},
    locations: [{ bigBoxCode: "D-02", qty: 64, lastCountedAt: "2026-06-11" }],
    history: [
      { kind: "received", occurredAt: "2026-06-09", qty: 30, reason: "built in-house", unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000701",
    category: "Connector",
    value: "Micro USB B recept.",
    voltage: null,
    package: "TH",
    mpn: "USB3145-30-1-A",
    lcsc_pn: null,
    manufacturer: "GCT",
    part_status: "active",
    reorder_point: 10,
    attributes: {},
    locations: [{ bigBoxCode: "D-06", qty: 4, lastCountedAt: "2026-06-12" }],
    history: [
      { kind: "received", occurredAt: "2026-03-05", qty: 50, distributor: "Digikey", unitPrice: 28 },
      { kind: "picked", occurredAt: "2026-06-12", qty: -46, unitPrice: null },
    ],
  },
  {
    internal_pid: "SMK-000503",
    category: "Module",
    value: "ESP32-WROOM-32",
    voltage: null,
    package: "SMD-38",
    mpn: "ESP32-WROOM-32E",
    lcsc_pn: "C701342",
    manufacturer: "Espressif",
    part_status: "active",
    reorder_point: 15,
    attributes: {},
    locations: [{ bigBoxCode: "C-09", qty: 23, lastCountedAt: "2026-06-17" }],
    history: [{ kind: "received", occurredAt: "2026-06-14", qty: 40, distributor: "LCSC", unitPrice: 210 }],
  },
];
