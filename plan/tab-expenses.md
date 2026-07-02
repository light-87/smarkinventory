# Expenses (NEW tab — R2-20 / R2-21; owner + accountant)

**Route (proposed):** `#/expenses` · **Introduced by:** R2-20 (entries), R2-21 (charts dashboard) ·
**No baseline — new tab.** **Q-01 closed:** visible to **owner (full) + accountant (read/WRITE —
client's amendment)**; hidden from employees.

## 1. Purpose

The company money view: record expenses and income ("and stuff" — fields still open, Q-09), then see
monthly/yearly health in charts. Per-project payments (R2-15, parked) would slot in here via a
project link on income entries.

## 2. Planned behaviour

### A. Entries (R2-20) 🟢 — fields FINAL (Q-09 closed)
- **Add entry:** type (Expense / Income) · amount ₹ · date · **account** (cash/bank/UPI list from
  Settings, R2-28) · category (Materials, Salaries, Rent, Utilities, Tools, Client payment, Other)
  · **vendor/party** · note · optional **project link** (= payments, R2-15) · optional attachment
  (bill → R2) · optional **GST fields** (GSTIN, tax amount).
- **Entry list:** filter by month/type/category/account/project; edit/delete (soft delete, audit).
- **PO → draft expense (Q-09):** each placed order (R2-12) auto-creates a **draft** entry (total,
  vendor = distributor, projects from lines); owner confirms/edits → becomes real. Drafts chip-
  flagged; notification on creation (R2-36). No silent money rows.
- **Payments (R2-15 active):** income entries with a project link render in that project's
  Payments strip automatically.

### B. Charts dashboard (R2-21) 🟢
- Period switcher: **monthly · quarterly · yearly**.
- Chart set: income vs expense bars per month · cumulative net line · category donut · by-account
  split · top-projects income · YoY comparison.
- Summary tiles: this month in/out/net · this year in/out/net.
- **AI spend meter (R2-37):** ₹/run + monthly AI-spend series from `agent_runs.actual_cost`,
  rendered as its own small chart + tile ("AI sourcing cost this month") — trust surface for the
  agent feature.

### C. Cross-surfaces
- **Daily Reports:** per-day Expenses section — owner sees it; accountant too (matrix); employees
  never.
- **Exports (R2-33):** entry list exports CSV/xlsx per filter (accountants live in Excel).
- Inventory value (R2-11) stays a stock stat — the PO draft-expense path is the only bridge between
  parts spend and this ledger (no double counting).

## 3. Data touched

| Read | Write |
|---|---|
| `smark_expenses`, rollup views (monthly/yearly/category) | `smark_expenses` (owner CRUD, soft delete), attachments → R2 |

## 4. Talks to (edges)

- **Daily Reports** — owner-only day section (R2-20).
- **Projects hub** — R2-15 payments seam: income entries with `project_id` could render in a
  project Payments strip (parked 🔵 until Q-09).
- **Cart/PO** (potential, Q-09): auto-draft an expense entry from a placed PO's total.
- **Roles:** owner-only per client. `accountant` (R2-01) exists but is excluded here by the client's
  words — contradiction flagged into **Q-01** ("accountant sees expenses? read-only?").

## 5. Round-2 changes

- **R2-20** — entries (fields final) 🟢 · **R2-21** — charts 🟢 · **R2-15** — payments strip 🟢 ·
  **R2-37** — AI spend meter 🟢 · **R2-33** — exports 🟢

## 6. Open questions on this tab

*(none — Q-09 and Q-01 closed; accountant writes here per client amendment)*
