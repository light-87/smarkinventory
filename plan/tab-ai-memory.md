# AI Memory (learned rules)

**Route:** `#/memory` · **Spec:** FEATURES.md §10 · **Prototype:** `isMemory`.

## 1. Purpose (baseline)

The reviewable brain: corrections from order reviews become **suggested** rules; a human approves →
they become **active**, versioned, and injected (as a digest) into the next run's planner. Nothing
trains the model; everything is retire-able.

## 2. Current behaviour (as prototyped)

- Header: title + **Rules v{N}** pill; trust copy ("advisory, fully reviewable, nothing trains the
  model") + latest diff line (e.g. `v3 → v4: +1 rule (prefer LCSC for GCU caps)`).
- **Suggested rules** (orange cards, only when pending): scope pill (Part / Category / Distributor /
  Project / Global / Order) · subject · rule text · source quote ("from *'we already stock this'*") ·
  **Approve** (→ active, version++) / **Reject**.
- **Active rules table:** Scope · Subject · Rule · Confidence (high/med colored) · **Retire**.
  Baseline seed examples: prefer LCSC for GCU 0.1µF caps; C14663 already stocked don't reorder <500;
  Unikey only if cheaper AND in stock; Power Breezer automotive-grade only; never substitute package.

## 3. Data touched

| Read | Write |
|---|---|
| `smark_learned_rules` (suggested + active), `smark_learned_rules_doc` (version, diff) | rule status flips (suggested→active/rejected, active→retired), new digest version per approval |

## 4. Talks to (edges)

- ← **Order review** feedback + whole-order remarks arrive as suggested (A2-8).
- → **Ordering workspace** context card (v + count + preview) and → **Agent run** master prompt
  digest (A2-9); run log cites which rule hit which line (anti-drift traceability).
- Approvals = Manager-only when roles land (shell/RLS).
- Invariant: suggested never auto-activates; retire takes effect next run.

## 5. Round-2 changes

### R2-17 (ripple) — digest is pseudonymized before injection 🟡
Rules may name clients/projects ("Power Breezer → automotive-grade only"). The digest handed to the
planner passes through the alias layer (PROJ-03 instead of the client-visible name); the AI-Memory
SCREEN keeps real names (it's internal UI). Rule subjects referencing parts keep real MPN/PID
(public identifiers). Q-08 governs the wider "all-context model".

## 6. Open questions on this tab

*(none yet)*
