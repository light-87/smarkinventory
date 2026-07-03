import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { canSee, canWrite } from "@/lib/auth/roles";
import { EmptyState } from "@/components/ui/empty-state";
import { CartScreen } from "@/components/cart/cart-screen";
import { recomputeShortfallCartItems } from "@/lib/orders/demand";
import { getActiveDistributors, getArrivedGroups, getCartLines, getOrderedGroups } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Cart" };

/**
 * `#/cart` (FEATURES.md §5.12 · plan/tab-on-order.md). Cart-orders owns this
 * route (docs/OWNERSHIP.md).
 */
export default async function CartPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: role } = user ? await supabase.rpc("smark_role") : { data: null };

  if (!role || !canSee(role, "cart")) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Sign in with an owner, employee, or accountant account to view the cart." />
      </div>
    );
  }

  // Q-05 on-load recompute (lib/orders/demand.ts module doc explains the
  // trigger-choice tradeoff) — best-effort: a failure here shouldn't blank
  // the whole page, since the cart's existing lines are still readable.
  try {
    await recomputeShortfallCartItems(supabase);
  } catch (err) {
    console.error("cart: shortfall recompute failed", err);
  }

  const [cartLines, distributors, orderedGroups, arrivedGroups] = await Promise.all([
    getCartLines(supabase),
    getActiveDistributors(supabase),
    getOrderedGroups(supabase),
    getArrivedGroups(supabase),
  ]);

  return (
    <CartScreen
      cartLines={cartLines}
      distributors={distributors}
      orderedGroups={orderedGroups}
      arrivedGroups={arrivedGroups}
      canWrite={canWrite(role, "cart")}
    />
  );
}
