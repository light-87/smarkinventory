/**
 * lib/ai — the shared AI plumbing (docs/OWNERSHIP.md: owned by ai-memory;
 * cross-package import allowance lists cart-orders / bom-pipeline / receive
 * as consumers). Import from here, not from the individual files, unless
 * you're inside this package.
 */

// Claude client seam
export {
  getClaude,
  AnthropicAdapter,
  MockAdapter,
  type ClaudePort,
  type ClaudePromptKind,
  type ClaudeMessage,
  type ClaudeContentBlock,
  type ClaudeCompleteRequest,
  type ClaudeCompleteResponse,
  type ClaudeUsage,
} from "./client";

// Alias layer
export {
  ensureAliases,
  aliasText,
  deAliasText,
  buildPlannerContext,
  renderPlannerContextText,
  buildGlobalAliasMapping,
  computeAliasAssignments,
  deterministicEntityId,
  type AliasKind,
  type AliasRow,
  type AliasAssignments,
  type PlannerProjectInput,
  type PlannerBomLineInput,
  type PlannerContextInput,
  type PlannerContext,
} from "./alias";

// Rules digest
export {
  buildDigestContent,
  buildChangeSummary,
  renderRuleText,
  scopeLabel,
  aliasDigestForInjection,
  approveRule,
  rejectRule,
  retireRule,
  type LearnedRuleValue,
  type RuleTransitionResult,
} from "./digest";

// Extraction helpers
export {
  extractReceipt,
  normalizeMpn,
  type ExtractReceiptInput,
  type ReceiptExtractLine,
  type ReceiptExtractResult,
  type NormalizeMpnResult,
} from "./extract";

// Screen queries + actions (used by app/(app)/ai-memory and its own tests)
export {
  getSuggestedRules,
  getActiveRules,
  getDigestSummary,
  getDigestForInjection,
  getRuleRunLog,
  getAiMemoryScreenData,
} from "./queries";

export { approveRuleAction, rejectRuleAction, retireRuleAction } from "./actions";

export type {
  ActionResult,
  RuleListItem,
  SuggestedRuleItem,
  ActiveRuleItem,
  RulesDigestSummary,
  RuleRunLogItem,
  AiMemoryScreenData,
} from "./types";
