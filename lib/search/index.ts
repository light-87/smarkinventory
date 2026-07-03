/**
 * lib/search — global Ctrl-K palette query builders + server action
 * (docs/OWNERSHIP.md: owned by `search-notifications`).
 */

export {
  looksLikeScanCode,
  searchParts,
  searchProjects,
  searchBoms,
  searchOrders,
  searchPalette,
  isEmptyPaletteResults,
  partHref,
  boxHref,
  projectHref,
  bomHref,
  orderHref,
  type PalettePartHit,
  type PaletteProjectHit,
  type PaletteBomHit,
  type PaletteOrderHit,
  type PaletteResults,
} from "./queries";
export { runPaletteSearch, type PaletteSearchResult } from "./actions";
