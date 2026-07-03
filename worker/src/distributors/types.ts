/**
 * worker/src/distributors/types.ts — the `DistributorClient` interface every
 * REST/Browser integration implements (FEATURES.md §4/§15).
 */

import type { DistributorApiType, PartLifecycleStatus } from "../../../types/worker";

export interface DistributorSearchQuery {
  mpn: string | null;
  lcscPn: string | null;
  value: string | null;
  packageName: string | null;
  /** Minimum quantity the listing must be able to fill (ladder rung 6). */
  qty: number;
}

export interface DistributorQtyBreak {
  qty: number;
  unitPrice: number;
}

/** One listing as reported by a distributor, BEFORE ladder evaluation (see matcher-lite.ts). */
export interface DistributorListing {
  distributorName: string;
  title: string;
  /** The distributor's own MPN string for this listing, if it reports one. */
  mpn: string | null;
  packageName: string | null;
  price: number | null;
  currency: string;
  qtyBreaks: DistributorQtyBreak[];
  stockQty: number | null;
  partStatus: PartLifecycleStatus | null;
  orderLink: string | null;
  /** Full raw payload — server-controlled, never forwarded to the client unfiltered. */
  raw: unknown;
}

export interface DistributorClient {
  readonly name: string;
  readonly apiType: DistributorApiType;
  search(query: DistributorSearchQuery): Promise<DistributorListing[]>;
}
