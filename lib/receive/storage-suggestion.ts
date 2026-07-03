/**
 * lib/receive/storage-suggestion.ts — "AI-suggested storage" for new stock
 * (plan/tab-receive.md §2A: "→ B-12 · Capacitors 0603 · Shelf B").
 *
 * Pure, deterministic, no AI call yet (per the build brief) — category+package
 * match over the existing Big Boxes. When nothing matches, proposes a NEW box
 * under a fallback "Unsorted" shelf so a New-part save always resolves to
 * *some* home instead of leaving qty un-located (see lib/receive/core.ts —
 * `resolveBox`), which also keeps the onboarding queue scoped to the real
 * import backlog rather than every fresh save.
 */

/** Slim big-box projection this module needs — callers map their DB row into this shape. */
export interface BoxOption {
  id: string;
  name: string;
  shelfCode: string;
  category: string | null;
}

export type StorageSuggestion =
  | { kind: "existing"; boxId: string; boxName: string; shelfCode: string; label: string }
  | { kind: "new"; boxName: string; shelfCode: string; label: string };

/** Fallback shelf for categories/packages with no matching box yet. */
export const FALLBACK_SHELF_CODE = "U";
export const FALLBACK_SHELF_NAME = "Unsorted";

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Suggests where a part with the given category/package should live.
 * - Prefers an existing box whose `category` matches (case-insensitive).
 * - Among matches, prefers one whose NAME also hints at the package
 *   (e.g. a box named "Capacitors 0603" beats a general "Capacitors" box).
 * - Falls back to proposing a NEW box (named after category+package) on the
 *   catch-all "Unsorted" shelf — the owner can re-home it later from Shelves.
 */
export function suggestStorageBox(
  category: string | null | undefined,
  pkg: string | null | undefined,
  boxes: readonly BoxOption[],
): StorageSuggestion {
  const categoryNorm = norm(category);
  const candidates = categoryNorm ? boxes.filter((b) => norm(b.category) === categoryNorm) : [];

  if (candidates.length > 0) {
    const pkgNorm = norm(pkg);
    const withPackageHint = pkgNorm ? candidates.find((b) => norm(b.name).includes(pkgNorm)) : undefined;
    const chosen = withPackageHint ?? candidates[0]!;
    const specs = [category, pkg].filter(Boolean).join(" ");
    return {
      kind: "existing",
      boxId: chosen.id,
      boxName: chosen.name,
      shelfCode: chosen.shelfCode,
      label: `→ ${chosen.name}${specs ? ` · ${specs}` : ""} · Shelf ${chosen.shelfCode}`,
    };
  }

  const proposedName = [category, pkg].filter(Boolean).join(" ") || "General";
  return {
    kind: "new",
    boxName: proposedName,
    shelfCode: FALLBACK_SHELF_CODE,
    label: `→ New box "${proposedName}" · Shelf ${FALLBACK_SHELF_CODE} (${FALLBACK_SHELF_NAME.toLowerCase()}, re-home later)`,
  };
}
