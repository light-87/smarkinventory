# Pending Decisions / Discuss-Laters (Q-NN)

> Every "we'll discuss later", every ambiguity, every overlap that needs the client's (or Vaibhav's)
> call lands here — so the plan can move on without losing it. A question is CLOSED only when its
> resolution is written back into the tab file(s) + schema and the linked change flips to 🟢.

## Open

| ID | Raised by | Question | What's blocked until answered | Suggested default |
|---|---|---|---|---|
| — | | **ALL QUESTIONS CLOSED** (2026-07-02) — plan fully green; FEATURES.md v2 regenerated | | |

## Parked / declined ideas (for the record)

- **I-03 low-stock auto-cart** — declined by client ("not that important"). Reorder-point still
  drives low-stock UI everywhere; it just never auto-adds cart lines.
- **I-09 merge-parts tool** — parked as FUTURE; duplicate-guard (R2-31) reduces the need meanwhile.

## Closed

| ID | Question | Resolution | Written into |
|---|---|---|---|
| Q-01 | Role access matrix | Matrix as proposed, ONE amendment: **accountant gets WRITE on Expenses**. Owner full; employee operational (no Settings/AI-approve/Expenses/user-mgmt, Daily self-only); accountant read-only ops + Expenses read/write + Daily read | `tab-login-shell.md` (canonical matrix), SCHEMA RLS, per-tab notes |
| Q-02 | PIN fate | PIN killed; username+password sessions persist per device; manual logout | `tab-login-shell.md`, `tab-settings.md` |
| Q-03 | Attendance + hours capture | Attendance = self clock-in/clock-out. Hours per project = **manual entry** ("manually is doable") — no derived model; owner can edit | `tab-daily-reports.md`, SCHEMA `smark_time_entries` |
| Q-04 | Client timeline sharing | Tokenized read-only share link approved + upgraded: full **phase timeline builder** per the client's estimate sheet (R2-30) rendered on a client portal page (R2-38); client comments → `change` activities | `tab-orders-projects.md`, `tab-client-portal.md`, SCHEMA |
| Q-06 | PO granularity | PO number = **distributor website's order number** (for matching deliveries) → checkout groups by distributor; one order + order-number per distributor group | `tab-on-order.md`, SCHEMA `smark_orders` |
| Q-08 | All-context AI scope | Phased as proposed: v1 alias layer only; v2 internal chat assistant in **Phase 4** | `tab-agent-run.md`, `tab-ai-memory.md`, build order |
| Q-09 | Finance fields | Approved: date/type/amount/account/category/vendor/note/project/attachment + optional GST fields; **PO auto-creates a draft expense** (owner confirms); **payments = income entries with project link** (activates R2-15) | `tab-expenses.md`, SCHEMA `smark_expenses` |
| Q-10 | Box audit flow | Approved: guided count per ESD, variances = `adjust` movements tagged `audit`, `last_counted_at` stamped, partial/resumable | `tab-shelves.md`, `tab-scan.md` |
| Q-05 | Smart-cart demand lifecycle | Default approved: demand registers when an ACTIVE BOM is reconciled; released per-line by bulk takeout, arrival allocation, or project archive (R2-32); dismissed auto-lines resurrect only if shortfall grows beyond the dismissed qty | `tab-on-order.md`, SCHEMA `v_part_demand` |
| Q-07 | Completion/performance math | Approved: completion % = duration-weighted done phases; on-track = today vs ACTIVE phase end date (buffer rows absorb delay before "late"); project done = last phase done + owner confirm; manual slider dropped | `tab-orders-projects.md`, `tab-client-portal.md`, SCHEMA |

## Ground rules

- Give every question a **suggested default** — when the client is slow to answer we can propose the
  default and keep the plan complete.
- If two R2 changes conflict, the conflict itself becomes a Q — never silently pick a winner.
- "Discuss later" items the client parks get a Q row immediately, status 🔵 in the change log, so the
  end-of-intake checklist can't pass while any are unresolved.
