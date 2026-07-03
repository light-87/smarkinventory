#!/usr/bin/env bun
/**
 * scripts/import-stock.ts — alias for `scripts/import-stocklist.ts`.
 *
 * docs/OWNERSHIP.md names this script `scripts/import-stock.ts`; the
 * package's build mission named it `scripts/import-stocklist.ts`. Rather
 * than guess which name other docs/CI steps will reference, both exist —
 * this file just re-runs the real implementation.
 */
import "./import-stocklist";
