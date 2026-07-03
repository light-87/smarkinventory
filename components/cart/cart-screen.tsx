"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { DistributorRow } from "@/types/db";
import type { CartLineView, OrderGroupView } from "@/lib/orders/queries";
import { ArrivedTab } from "./arrived-tab";
import { CartTab } from "./cart-tab";
import { OrderedTab } from "./ordered-tab";

export type CartSection = "cart" | "ordered" | "arrived";

export interface CartScreenProps {
  cartLines: readonly CartLineView[];
  distributors: readonly DistributorRow[];
  orderedGroups: readonly OrderGroupView[];
  arrivedGroups: readonly OrderGroupView[];
  canWrite: boolean;
}

/** Everything between "we want it" and "it's on the shelf" (FEATURES.md §5.12). */
export function CartScreen({ cartLines, distributors, orderedGroups, arrivedGroups, canWrite }: CartScreenProps) {
  const [section, setSection] = useState<CartSection>("cart");
  const openCartCount = cartLines.filter((l) => l.status === "open").length;
  const orderedCount = orderedGroups.reduce((sum, g) => sum + g.lines.length, 0);
  const arrivedCount = arrivedGroups.reduce((sum, g) => sum + g.lines.length, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 pb-28 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-heading-sm font-normal text-snow">Cart</h1>
        <SegmentedControl
          aria-label="Cart section"
          value={section}
          onChange={setSection}
          options={[
            { value: "cart", label: `Cart (${openCartCount})` },
            { value: "ordered", label: `Ordered (${orderedCount})` },
            { value: "arrived", label: `Arrived (${arrivedCount})` },
          ]}
        />
      </div>

      {!canWrite && (
        <EmptyState
          tone="subtle"
          title="Read-only"
          description="Your role can view the cart and orders but can't make changes here."
        />
      )}

      {section === "cart" && <CartTab lines={cartLines} distributors={distributors} canWrite={canWrite} />}
      {section === "ordered" && <OrderedTab groups={orderedGroups} canWrite={canWrite} />}
      {section === "arrived" && <ArrivedTab groups={arrivedGroups} canWrite={canWrite} />}
    </div>
  );
}
