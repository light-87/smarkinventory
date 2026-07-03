import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Cart" };

// Placeholder — cart-orders owns app/(app)/cart/** (docs/OWNERSHIP.md).
export default function CartPage() {
  return (
    <PlaceholderPage
      area="cart"
      title="Cart is on its way"
      description="The smart cross-project cart, checkout and order tracking will live here."
    />
  );
}
