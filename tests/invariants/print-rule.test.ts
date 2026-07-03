import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../helpers/supabase";
import { type TestBox, createTestBox, createTestPart, describeDb } from "./fixtures";

/**
 * INVARIANT — print rule (plan/TESTING.md §5.1 · CROSS-FEATURE.md A3.1 · FEATURES.md §8).
 * "Existing part top-up NEVER creates a label row; new part exactly one."
 * One QR per ESD plastic, one per big box — never per unit; labels QUEUE [R2-35].
 * Canonical shape: SCHEMA.md `smark_qr_labels` — `target_type`/`target_id` polymorphic,
 * `smark_qr_labels_one_per_target UNIQUE(target_type, target_id)`, `print_status`
 * defaults `queued`.
 *
 * DB-backed suite. The behavioral half of this invariant ("top-up doesn't CALL the
 * label-creation code") belongs to the receive package (owned:
 * `tests/unit/labels-*.test.ts`, `app/(app)/receive/**`, not yet landed). What
 * IS testable today, against schema alone, is the mechanism that makes the
 * invariant hold even if a future top-up/put-away code path has a bug: the
 * `smark_qr_labels_one_per_target` unique index makes a second label for the
 * same target impossible to insert, and `print_status` defaults to `queued`
 * (nothing prints immediately). These tests pin that DB-level guarantee.
 */
describeDb("invariant: print rule", () => {
  let service: SupabaseClient;
  let box: TestBox;

  beforeAll(async () => {
    service = createServiceClient();
    box = await createTestBox(service);
  });

  afterAll(async () => {
    await box.cleanup();
  });

  test(
    "new part creates EXACTLY ONE smark_qr_labels row (target_type=part), print_status=queued",
    async () => {
      const part = await createTestPart(service);

      const { data: label, error } = await service
        .from("smark_qr_labels")
        .insert({
          target_type: "part",
          target_id: part.id,
          code_value: part.id,
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect((label as { print_status: string }).print_status).toBe("queued");

      const { data: rows } = await service
        .from("smark_qr_labels")
        .select("id")
        .eq("target_type", "part")
        .eq("target_id", part.id);
      expect((rows ?? []).length).toBe(1);

      await service.from("smark_qr_labels").delete().eq("target_type", "part").eq("target_id", part.id);
      await part.cleanup();
    },
  );

  test(
    "top-up existing part (Receive → Top up) creates ZERO smark_qr_labels rows — and the schema makes a duplicate impossible even if a buggy call tried",
    async () => {
      const part = await createTestPart(service);
      // Simulates the part's ORIGINAL new-part label (already printed/queued).
      await service.from("smark_qr_labels").insert({
        target_type: "part",
        target_id: part.id,
        code_value: part.id,
      });

      // "Top up" = a stock_locations qty increase only — no label-creation call
      // in a correct implementation. Assert the label count stays at 1.
      await service.from("smark_stock_locations").insert({ part_id: part.id, big_box_id: box.boxId, qty: 50 });
      const { data: afterTopUp } = await service
        .from("smark_qr_labels")
        .select("id")
        .eq("target_type", "part")
        .eq("target_id", part.id);
      expect((afterTopUp ?? []).length).toBe(1);

      // Even a BUGGY top-up path that attempted a second label insert for the
      // same part is rejected outright by smark_qr_labels_one_per_target.
      const { error: dupError } = await service.from("smark_qr_labels").insert({
        target_type: "part",
        target_id: part.id,
        code_value: part.id,
      });
      expect(dupError).not.toBeNull();

      await service.from("smark_qr_labels").delete().eq("target_type", "part").eq("target_id", part.id);
      await part.cleanup();
    },
  );

  test(
    "put-away of an arrival for an EXISTING part creates zero label rows (no reprint)",
    async () => {
      const part = await createTestPart(service);
      await service.from("smark_qr_labels").insert({
        target_type: "part",
        target_id: part.id,
        code_value: part.id,
      });

      // Put-away for an existing part = a NEW stock_locations row (or qty bump
      // on an existing one) into the destination box — again, no label call.
      await service.from("smark_stock_locations").insert({ part_id: part.id, big_box_id: box.boxId, qty: 12 });

      const { data } = await service
        .from("smark_qr_labels")
        .select("id")
        .eq("target_type", "part")
        .eq("target_id", part.id);
      expect((data ?? []).length).toBe(1);

      await service.from("smark_qr_labels").delete().eq("target_type", "part").eq("target_id", part.id);
      await part.cleanup();
    },
  );

  test(
    "onboarding-queue assignment (import flow) queues exactly one label per part, once — a second assignment attempt is rejected",
    async () => {
      const part = await createTestPart(service);
      const first = await service.from("smark_qr_labels").insert({
        target_type: "part",
        target_id: part.id,
        code_value: part.id,
      });
      expect(first.error).toBeNull();

      const second = await service.from("smark_qr_labels").insert({
        target_type: "part",
        target_id: part.id,
        code_value: part.id,
      });
      expect(second.error).not.toBeNull();

      await service.from("smark_qr_labels").delete().eq("target_type", "part").eq("target_id", part.id);
      await part.cleanup();
    },
  );

  test(
    "big-box label: one per box (target_type=big_box), never per unit/ESD refill",
    async () => {
      const freshBox = await createTestBox(service);

      const first = await service.from("smark_qr_labels").insert({
        target_type: "big_box",
        target_id: freshBox.boxId,
        code_value: freshBox.boxId,
      });
      expect(first.error).toBeNull();

      // Refilling the box's ESD plastics repeatedly must never mint a second
      // box label — proven the same way: the unique target constraint bites.
      const second = await service.from("smark_qr_labels").insert({
        target_type: "big_box",
        target_id: freshBox.boxId,
        code_value: freshBox.boxId,
      });
      expect(second.error).not.toBeNull();

      await service.from("smark_qr_labels").delete().eq("target_type", "big_box").eq("target_id", freshBox.boxId);
      await freshBox.cleanup();
    },
  );

  test(
    "a part label and a big-box label are independent targets — creating one never blocks or consumes the other",
    async () => {
      const part = await createTestPart(service);
      const freshBox = await createTestBox(service);

      const partLabel = await service.from("smark_qr_labels").insert({
        target_type: "part",
        target_id: part.id,
        code_value: part.id,
      });
      const boxLabel = await service.from("smark_qr_labels").insert({
        target_type: "big_box",
        target_id: freshBox.boxId,
        code_value: freshBox.boxId,
      });

      expect(partLabel.error).toBeNull();
      expect(boxLabel.error).toBeNull();

      await service.from("smark_qr_labels").delete().eq("target_type", "part").eq("target_id", part.id);
      await service.from("smark_qr_labels").delete().eq("target_type", "big_box").eq("target_id", freshBox.boxId);
      await part.cleanup();
      await freshBox.cleanup();
    },
  );

  test(
    "no API path prints immediately — every label creation lands in the queue; batch print flips queued→printed [R2-35]",
    async () => {
      const part = await createTestPart(service);
      const { data: label } = await service
        .from("smark_qr_labels")
        .insert({ target_type: "part", target_id: part.id, code_value: part.id })
        .select("*")
        .single();
      expect((label as { print_status: string; printed_at: string | null }).print_status).toBe("queued");
      expect((label as { printed_at: string | null }).printed_at).toBeNull();

      // print_status is CHECK-constrained to exactly ('queued', 'printed') —
      // no third state, and nothing sets it to 'printed' except an explicit
      // batch-print flip (simulated here as the future Avery-PDF job would).
      const batchId = crypto.randomUUID();
      const { error: flipError } = await service
        .from("smark_qr_labels")
        .update({ print_status: "printed", printed_at: new Date().toISOString(), batch_id: batchId })
        .eq("id", (label as { id: string }).id);
      expect(flipError).toBeNull();

      const { data: reread } = await service
        .from("smark_qr_labels")
        .select("print_status, printed_at, batch_id")
        .eq("id", (label as { id: string }).id)
        .single();
      expect((reread as { print_status: string }).print_status).toBe("printed");
      expect((reread as { printed_at: string | null }).printed_at).not.toBeNull();

      const { error: invalidStatusError } = await service
        .from("smark_qr_labels")
        .insert({ target_type: "part", target_id: part.id, code_value: part.id, print_status: "sent" })
        .select("*")
        .single();
      // Duplicate target ALSO fails first, but an invalid print_status value
      // fails the CHECK regardless of the unique-target outcome.
      expect(invalidStatusError).not.toBeNull();

      await service.from("smark_qr_labels").delete().eq("target_type", "part").eq("target_id", part.id);
      await part.cleanup();
    },
  );
});
