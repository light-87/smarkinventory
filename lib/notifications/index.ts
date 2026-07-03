/**
 * lib/notifications — fan-out helpers other packages import to write
 * `smark_notifications` rows (docs/OWNERSHIP.md: owned by
 * `search-notifications`; cross-package import allowance lists cart-orders /
 * projects-hub / ai-memory / portal as consumers).
 */

export {
  notify,
  notifyArrival,
  notifyTaskAssigned,
  notifyRulePending,
  notifyLowStock,
  notifyRunDone,
  notifyExpenseDraft,
  notifyPortalComment,
} from "./fanout";
