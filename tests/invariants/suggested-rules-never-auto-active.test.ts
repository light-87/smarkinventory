import { describe, test } from "bun:test";

/**
 * INVARIANT — suggested rules never auto-active (plan/TESTING.md §5.7 ·
 * CROSS-FEATURE.md A3.5 · FEATURES.md §16 "suggested-never-auto-active").
 * "Suggested rules never active without an approval event by an authorized
 * role." "AI memory is advisory, versioned, reviewable — suggested never
 * silently becomes active."
 * Canonical shape: SCHEMA.md `smark_learned_rules.status`
 * (suggested/active/retired, `superseded_by`), `smark_learned_rules_doc`
 * (versioned digest, `version` v++ per change). `lib/auth/roles.ts
 * canApproveRules` — owner-only (AI Memory approve · Settings · user
 * management row, FEATURES.md §2).
 * Applies at: unit (rule-status transition function), DB (RLS — approval
 * write path restricted to owner, mirrors rls-matrix.test.ts), API (AI
 * Memory approve/reject/retire routes), E2E-1 (employee cannot approve
 * rules — UI + RLS both).
 * Skeleton (test.todo) until the AI-memory package lands. Convert todos to
 * real tests in place — keep the names.
 */

describe("invariant: suggested rules never auto-active", () => {
  test.todo(
    "a rule created from feedback (smark_agent_feedback → converted_rule_id) always lands with status='suggested', never 'active', regardless of confidence score",
    () => {},
  );
  test.todo(
    "no API/DB path transitions a rule suggested→active without an explicit approval event recorded (approver user_id + timestamp persisted, not inferred)",
    () => {},
  );
  test.todo(
    "only an authorized role (owner — canApproveRules) can approve a suggested rule; employee and accountant attempts are rejected by BOTH the UI (hidden) and RLS (denied), mirroring FEATURES.md §2 'enforced twice'",
    () => {},
  );
  test.todo(
    "approving a rule and bumping smark_learned_rules_doc.version happen atomically — no state exists where a rule is active but the digest version wasn't bumped, or vice versa",
    () => {},
  );
  test.todo(
    "a REJECTED suggested rule never appears in any digest version and is not auto-resurrected by a similar future feedback event",
    () => {},
  );
  test.todo(
    "retiring an active rule sets status='retired' (+ superseded_by where applicable) and removes it from the NEXT digest version — a retired rule never silently re-activates",
    () => {},
  );
  test.todo(
    "the Opus master-plan prompt only ever includes rules from the CURRENT active digest version — a suggested-but-unapproved rule is never injected into a run's context",
    () => {},
  );
  test.todo(
    "run log 'why' lines (agent result rationale) can only cite rules that were active at the time the run executed, not rules approved after the fact",
    () => {},
  );
});
