/**
 * lib/movements — the movement + undo write path (FEATURES.md §9).
 * Owned by `scan`; imported read-only by `receive` and `takeout`
 * (docs/OWNERSHIP.md cross-package import allowance).
 */

export {
  applyDelta,
  assertUndoable,
  buildMovementInsert,
  buildUndoInsert,
  sumLocationQty,
} from "./pure";
export { isUniqueViolation, recordMovement, undoMovement } from "./service";
export {
  MovementValidationError,
  type MovementInput,
  type MovementInsertRow,
  type MovementResult,
  type UndoableMovement,
} from "./types";
