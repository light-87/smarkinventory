import { describe, expect, test } from "bun:test";
import { classifyOnboardingRows, type PartLocationRef } from "@/lib/receive/queries";
import {
  FALLBACK_SHELF_CODE,
  IMPORT_STAGING_BOX_NAME,
  type BoxOption,
} from "@/lib/receive/storage-suggestion";
import type { PartAttributes, PartRow } from "@/types/db";

/**
 * Regression cover for the onboarding queue going dead after the real stock
 * import (client report, 2026-08-11: "not able to assign them any new box").
 *
 * `scripts/import-formatted-csvs.ts` parks all ~2000 imported parts in the
 * `U-IMPORT` staging box so the catalog reads with true quantities on day one.
 * The queue's UI then gated its assign form on "this part has no location at
 * all", which had been true of every imported part before staging existed and
 * was true of NONE of them after — so tapping any row opened nothing.
 *
 * The distinction that actually matters is staging (assign it) vs already put
 * away on a real shelf (review it), which is what these tests pin down.
 */

function makePart(overrides: Partial<PartRow> & { id: string }): PartRow {
  return {
    created_at: "2026-08-10T00:00:00Z",
    updated_at: null,
    internal_pid: `SMK-${overrides.id}`,
    mpn: null,
    manufacturer: null,
    lcsc_pn: null,
    description: null,
    category: null,
    value: null,
    package: null,
    voltage: null,
    part_status: "active",
    datasheet_url: null,
    default_distributor: null,
    attributes: {} as PartAttributes,
    total_qty: 0,
    reorder_point: null,
    source_sheet: null,
    needs_review: true,
    last_unit_price: null,
    currency: "INR",
    created_by: null,
    ...overrides,
  };
}

const STAGING_BOX: BoxOption = {
  id: "box-staging",
  name: IMPORT_STAGING_BOX_NAME,
  shelfCode: FALLBACK_SHELF_CODE,
  category: null,
};

const REAL_BOX: BoxOption = { id: "box-a12", name: "A-12", shelfCode: "A", category: "Capacitor" };

const BOXES: BoxOption[] = [STAGING_BOX, REAL_BOX];

function loc(partId: string, boxId: string): PartLocationRef {
  return { part_id: partId, big_box_id: boxId };
}

describe("onboarding queue — staging vs put away", () => {
  test("an imported part sitting in the staging box is assignable, not review-only", () => {
    const part = makePart({ id: "p1", category: "Capacitor", total_qty: 255 });

    const [row] = classifyOnboardingRows([part], [loc("p1", STAGING_BOX.id)], BOXES);

    expect(row).toBeDefined();
    expect(row!.inStaging).toBe(true);
    // The bug: this used to be the flag the UI keyed off, and it was true here.
    expect(row!.placedElsewhere).toBe(false);
  });

  test("the whole imported catalog stays assignable, not just the first row", () => {
    const parts = Array.from({ length: 50 }, (_, i) => makePart({ id: `p${i}`, total_qty: i + 1 }));
    const locations = parts.map((p) => loc(p.id, STAGING_BOX.id));

    const rows = classifyOnboardingRows(parts, locations, BOXES);

    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.inStaging && !r.placedElsewhere)).toBe(true);
  });

  test("a part already put away on a real shelf is review-only", () => {
    const part = makePart({ id: "p2", category: "Capacitor" });

    const [row] = classifyOnboardingRows([part], [loc("p2", REAL_BOX.id)], BOXES);

    expect(row!.inStaging).toBe(false);
    expect(row!.placedElsewhere).toBe(true);
    expect(row!.suggestion).toBeNull();
  });

  test("a part with no location at all is still assignable", () => {
    const part = makePart({ id: "p3", category: "Capacitor" });

    const [row] = classifyOnboardingRows([part], [], BOXES);

    expect(row!.inStaging).toBe(false);
    expect(row!.placedElsewhere).toBe(false);
  });

  test("the staging box is never suggested as the destination", () => {
    // Category null on both the part and the staging box would otherwise match:
    // "" === "", and staging is the first box in the list.
    const part = makePart({ id: "p4", category: null });

    const [row] = classifyOnboardingRows([part], [loc("p4", STAGING_BOX.id)], BOXES);

    expect(row!.suggestion?.id).not.toBe(STAGING_BOX.id);
  });

  test("a staging part gets a real box suggested by category", () => {
    const part = makePart({ id: "p5", category: "Capacitor" });

    const [row] = classifyOnboardingRows([part], [loc("p5", STAGING_BOX.id)], BOXES);

    expect(row!.suggestion?.id).toBe(REAL_BOX.id);
  });

  test("splitting stock across staging and a real box counts as put away", () => {
    // The bulk case (reel + working box). Which row moves isn't ours to guess,
    // so it stays review-only rather than silently re-pointing one of them.
    const part = makePart({ id: "p6" });

    const [row] = classifyOnboardingRows(
      [part],
      [loc("p6", STAGING_BOX.id), loc("p6", REAL_BOX.id)],
      BOXES,
    );

    expect(row!.inStaging).toBe(false);
    expect(row!.placedElsewhere).toBe(true);
  });

  test("a reviewed, put-away part drops off the queue entirely", () => {
    const part = makePart({ id: "p7", needs_review: false });

    const rows = classifyOnboardingRows([part], [loc("p7", REAL_BOX.id)], BOXES);

    expect(rows).toHaveLength(0);
  });
});
