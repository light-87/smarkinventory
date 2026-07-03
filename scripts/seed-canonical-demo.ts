#!/usr/bin/env bun
/**
 * scripts/seed-canonical-demo.ts — writes the CANONICAL demo dataset
 * (tests/fixtures/canonical-seed-data.ts) to Supabase.
 *
 * Usage: bun run scripts/seed-canonical-demo.ts [--dry-run]
 *
 * Why a script and not `supabase/seed.sql`: docs/OWNERSHIP.md locks
 * `supabase/seed.sql` to the integrator ("append-only via assigned
 * numbers"); FEATURES.md §14's own wording allows either ("Extend
 * supabase/seed.sql (**or a seed script**)"). This is that seed script —
 * see this package's integrator report for how to wire it into
 * `supabase db reset` / CI if a single-command reset is wanted later.
 *
 * SERVICE-ROLE KEY, SCRIPT-ONLY — same rationale as
 * `scripts/import-stocklist.ts`: a one-shot operator/dev-seed tool, not
 * something an app route ever runs.
 *
 * Ports the SmarkStock-prototype's approved `buildMock()` fixture (plan/
 * TESTING.md §4: "the prototype's mock dataset... promoted to canonical
 * fixtures") into real rows: 4 shelves → 9 big boxes → the SMK-000101
 * family (15 parts) with real `smark_stock_locations`, a priced
 * receive/pick `smark_movements` + `smark_part_events` history, and
 * `last_unit_price` stamped from the latest priced arrival.
 *
 * Idempotent: safe to run against a DB that already has this data (matches
 * shelves by code, big boxes by shelf+name, parts by MPN/LCSC identity —
 * same normalizers as lib/matcher — history by a per-part row-count guard)
 * — reruns patch gaps rather than duplicating rows. On a database where the
 * intended `SMK-0001NN` PIDs are already taken by unrelated data (observed
 * in the shared local dev stack — other packages' leftover test fixtures),
 * falls back to the next free PID and logs a warning instead of failing.
 *
 * Depends on auth-shell's seeded role users (docs/OWNERSHIP.md: auth-shell
 * "seeds the role users" for the RLS matrix) — looks up the `owner` user by
 * username first, else any active owner-role row, to stamp as actor/
 * created_by. Run auth-shell's user seeding first if this errors out
 * looking for one.
 */

import { createServiceClient } from "@/lib/supabase/server";
import {
  buildIdentityMaps,
  fetchExistingPartIdentities,
  findByIdentity,
  type ExistingPartIdentity,
} from "@/lib/import/existing-parts";
import { TABLES } from "@/types/db";
import { CANONICAL_BIG_BOXES, CANONICAL_PARTS, CANONICAL_SHELVES } from "@/tests/fixtures/canonical-seed-data";

const dryRun = process.argv.includes("--dry-run");

async function findOwnerId(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
  const byUsername = await supabase.from(TABLES.app_users).select("id").eq("username", "owner").maybeSingle();
  if (byUsername.data?.id) return byUsername.data.id as string;

  const anyOwner = await supabase
    .from(TABLES.app_users)
    .select("id")
    .eq("role", "owner")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (anyOwner.data?.id) return anyOwner.data.id as string;

  throw new Error(
    "No owner-role smark_app_users row found — run auth-shell's role-user seeding first (docs/OWNERSHIP.md: auth-shell seeds the RLS-matrix role users).",
  );
}

async function upsertShelves(supabase: ReturnType<typeof createServiceClient>, ownerId: string) {
  const shelfIds = new Map<string, string>();
  for (const shelf of CANONICAL_SHELVES) {
    const existing = await supabase.from(TABLES.shelves).select("id").eq("code", shelf.code).maybeSingle();
    if (existing.data?.id) {
      shelfIds.set(shelf.code, existing.data.id as string);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry-run] would insert shelf ${shelf.code} (${shelf.name})`);
      continue;
    }
    const { data, error } = await supabase
      .from(TABLES.shelves)
      .insert({ code: shelf.code, name: shelf.name, created_by: ownerId })
      .select("id")
      .single();
    if (error) throw new Error(`Insert shelf ${shelf.code} failed: ${error.message}`);
    shelfIds.set(shelf.code, data!.id as string);
  }
  return shelfIds;
}

async function upsertBigBoxes(
  supabase: ReturnType<typeof createServiceClient>,
  ownerId: string,
  shelfIds: Map<string, string>,
) {
  const boxIds = new Map<string, string>();
  for (const box of CANONICAL_BIG_BOXES) {
    const shelfId = shelfIds.get(box.shelfCode);
    if (!shelfId) {
      console.warn(`  skipping big box ${box.code} — shelf ${box.shelfCode} was not created (dry-run?)`);
      continue;
    }
    const existing = await supabase
      .from(TABLES.big_boxes)
      .select("id")
      .eq("shelf_id", shelfId)
      .eq("name", box.name)
      .maybeSingle();
    if (existing.data?.id) {
      boxIds.set(box.code, existing.data.id as string);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry-run] would insert big box ${box.code} (${box.name})`);
      continue;
    }
    const { data, error } = await supabase
      .from(TABLES.big_boxes)
      .insert({ shelf_id: shelfId, name: box.name, category: box.category, created_by: ownerId })
      .select("id")
      .single();
    if (error) throw new Error(`Insert big box ${box.code} failed: ${error.message}`);
    boxIds.set(box.code, data!.id as string);
  }
  return boxIds;
}

/**
 * `reservedThisRun` guards against a subtler collision than an unrelated
 * pre-existing row: TWO canonical parts in the SAME run needing a fallback
 * (e.g. SMK-000101 is taken by other data, so part 1 falls back to
 * SMK-000102 — which is ALSO part 2's own desired PID). Every PID handed
 * out — desired or fallback — gets added immediately so later lookups in
 * the same run see it as unavailable even though nothing is committed yet.
 */
async function nextFreePid(
  supabase: ReturnType<typeof createServiceClient>,
  desired: string,
  reservedThisRun: Set<string>,
): Promise<string> {
  const isFree = async (pid: string) => {
    if (reservedThisRun.has(pid)) return false;
    const taken = await supabase.from(TABLES.parts).select("id").eq("internal_pid", pid).maybeSingle();
    return !taken.data;
  };

  if (await isFree(desired)) {
    reservedThisRun.add(desired);
    return desired;
  }

  console.warn(`  ${desired} is already taken — assigning the next free PID instead.`);
  const match = /^SMK-(\d+)$/.exec(desired);
  let n = match ? Number.parseInt(match[1]!, 10) : 1;
  for (;;) {
    n += 1;
    const candidate = `SMK-${String(n).padStart(6, "0")}`;
    if (await isFree(candidate)) {
      reservedThisRun.add(candidate);
      return candidate;
    }
  }
}

async function seedParts(
  supabase: ReturnType<typeof createServiceClient>,
  ownerId: string,
  boxIds: Map<string, string>,
) {
  const existingRows = await fetchExistingPartIdentities(supabase);
  const identityMaps = buildIdentityMaps(existingRows as unknown as ExistingPartIdentity[]);
  const reservedPids = new Set<string>();

  for (const part of CANONICAL_PARTS) {
    const existing = findByIdentity(identityMaps, part.mpn, part.lcsc_pn);
    let partId: string;

    if (existing) {
      partId = existing.id;
      reservedPids.add(existing.internal_pid);
    } else {
      const pid = await nextFreePid(supabase, part.internal_pid, reservedPids);
      if (dryRun) {
        console.log(`  [dry-run] would insert part ${pid} (${part.mpn})`);
        continue;
      }
      const lastPriced = [...part.history].reverse().find((h) => h.unitPrice !== null);
      const { data, error } = await supabase
        .from(TABLES.parts)
        .insert({
          internal_pid: pid,
          mpn: part.mpn,
          manufacturer: part.manufacturer,
          lcsc_pn: part.lcsc_pn,
          category: part.category,
          value: part.value,
          voltage: part.voltage,
          package: part.package,
          part_status: part.part_status,
          attributes: part.attributes,
          reorder_point: part.reorder_point,
          last_unit_price: lastPriced?.unitPrice ?? null,
          currency: "INR",
          needs_review: false, // curated canonical fixture, not a messy import row
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Insert part ${part.mpn} failed: ${error.message}`);
      partId = data!.id as string;
    }

    // Locations — idempotent per (part, big box).
    for (const loc of part.locations) {
      const boxId = boxIds.get(loc.bigBoxCode);
      if (!boxId) {
        console.warn(`  skipping location ${loc.bigBoxCode} for ${part.mpn} — big box not created (dry-run?)`);
        continue;
      }
      const existingLoc = await supabase
        .from(TABLES.stock_locations)
        .select("id")
        .eq("part_id", partId)
        .eq("big_box_id", boxId)
        .maybeSingle();
      if (existingLoc.data?.id) {
        if (!dryRun) {
          await supabase
            .from(TABLES.stock_locations)
            .update({ qty: loc.qty, last_counted_at: `${loc.lastCountedAt}T00:00:00Z` })
            .eq("id", existingLoc.data.id);
        }
        continue;
      }
      if (dryRun) {
        console.log(`  [dry-run] would insert location ${loc.bigBoxCode} qty=${loc.qty} for ${part.mpn}`);
        continue;
      }
      const { error } = await supabase.from(TABLES.stock_locations).insert({
        part_id: partId,
        big_box_id: boxId,
        qty: loc.qty,
        last_counted_at: `${loc.lastCountedAt}T00:00:00Z`,
        created_by: ownerId,
      });
      if (error) throw new Error(`Insert location ${loc.bigBoxCode} for ${part.mpn} failed: ${error.message}`);
    }

    // History (movements + part_events) — guarded by a row-count check so
    // reruns never duplicate it.
    if (dryRun) continue;
    const alreadySeeded = await supabase
      .from(TABLES.part_events)
      .select("id", { count: "exact", head: true })
      .eq("part_id", partId);
    if ((alreadySeeded.count ?? 0) > 0) continue;

    const firstBoxId = part.locations[0] ? boxIds.get(part.locations[0].bigBoxCode) : undefined;
    for (const event of part.history) {
      const occurredAt = `${event.occurredAt}T12:00:00Z`;
      const { error: moveErr } = await supabase.from(TABLES.movements).insert({
        part_id: partId,
        big_box_id: firstBoxId ?? null,
        delta_qty: event.qty,
        reason: event.kind === "received" ? "receive" : "pick",
        actor: ownerId,
        created_at: occurredAt,
      });
      if (moveErr) throw new Error(`Insert movement for ${part.mpn} failed: ${moveErr.message}`);

      const { error: eventErr } = await supabase.from(TABLES.part_events).insert({
        part_id: partId,
        event_type: event.kind,
        distributor: event.distributor ?? null,
        reason: event.reason ?? null,
        qty: event.qty,
        unit_price: event.unitPrice,
        location_big_box_id: firstBoxId ?? null,
        actor: ownerId,
        occurred_at: occurredAt,
      });
      if (eventErr) throw new Error(`Insert part_event for ${part.mpn} failed: ${eventErr.message}`);
    }
  }
}

async function main() {
  const supabase = createServiceClient();
  const ownerId = await findOwnerId(supabase);
  console.log(`Seeding canonical demo dataset (actor: owner ${ownerId})${dryRun ? " [dry-run]" : ""} ...`);

  console.log("Shelves...");
  const shelfIds = await upsertShelves(supabase, ownerId);
  console.log("Big boxes...");
  const boxIds = await upsertBigBoxes(supabase, ownerId, shelfIds);
  console.log("Parts + locations + history...");
  await seedParts(supabase, ownerId, boxIds);

  console.log(`\nDone. ${CANONICAL_SHELVES.length} shelves, ${CANONICAL_BIG_BOXES.length} big boxes, ${CANONICAL_PARTS.length} parts.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
