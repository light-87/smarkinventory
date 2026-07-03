import { describe, expect, test } from "bun:test";
import { getLineDistributorId, withLineDistributorId, type CartLineDescriptor } from "@/lib/orders/types";

/**
 * lib/orders/types.ts's `descriptor.distributor_id` workaround (see that
 * file's module doc): `smark_cart_items` has no plain `distributor_id`
 * column, so this package stores the user's distributor choice inside the
 * existing `descriptor` jsonb. Pinned here as pure unit tests since it's
 * load-bearing for every cart line regardless of source.
 */
describe("lib/orders/types — descriptor distributor_id workaround", () => {
  test("getLineDistributorId reads null when there's no descriptor at all", () => {
    expect(getLineDistributorId({ descriptor: null })).toBeNull();
  });

  test("getLineDistributorId reads null when the descriptor never had a distributor set", () => {
    expect(getLineDistributorId({ descriptor: { mpn: "CL10B104MB8NNNC" } })).toBeNull();
  });

  test("getLineDistributorId reads the stored distributor id", () => {
    const descriptor: CartLineDescriptor = { distributor_id: "dist-1" };
    expect(getLineDistributorId({ descriptor })).toBe("dist-1");
  });

  test("withLineDistributorId sets the id without dropping other descriptor keys (e.g. a non-catalogued part's mpn/value/package)", () => {
    const merged = withLineDistributorId({ mpn: "CL10B104MB8NNNC", value: "0.1uF" }, "dist-2");
    expect(merged).toEqual({ mpn: "CL10B104MB8NNNC", value: "0.1uF", distributor_id: "dist-2" });
  });

  test("withLineDistributorId starting from null descriptor produces just the distributor key", () => {
    expect(withLineDistributorId(null, "dist-3")).toEqual({ distributor_id: "dist-3" });
  });

  test("withLineDistributorId(..., null) clears a previous choice without erroring", () => {
    const descriptor: CartLineDescriptor = { distributor_id: "dist-1" };
    expect(withLineDistributorId(descriptor, null)).toEqual({ distributor_id: null });
  });
});
