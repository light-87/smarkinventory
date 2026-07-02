# Settings

**Route:** `#/settings` · **Spec:** FEATURES.md §5.4, §13, §3 env · **Prototype:** `isSettings`.

## 1. Purpose (baseline)

The owner's control panel: distributor connections, the global search ladder, PIN, label size,
low-stock behavior, agent concurrency default, connected accounts.

## 2. Current behaviour (as prototyped)

- **Distributors & API keys:** row per site (LCSC, Digikey, Mouser, Element14, Unikey) — masked key ·
  method detail (REST / browser) · status chip (Connected / Browser-agent).
- **Standard search rules (EDITABLE here, read-only in the workspace):** the 7-step ladder; Package
  pinned `required` (cannot be removed); each row removable; **Add rule** free-text input (e.g.
  "Prefer RoHS-compliant parts") → appended to every future order.
- **Small cards:** App PIN (4 dots) · Label size (Avery L7651 38×21mm dropdown) · Low-stock
  threshold (per-part reorder point mode) · Concurrency default (Balanced ~3 agents).
- **Connected accounts:** Vercel · Supabase · Claude chips ("you own these").

## 3. Data touched

| Read | Write |
|---|---|
| distributors, ordering rules, app config | `smark_ordering_rules` (add/remove custom), `smark_distributors` keys (server-side env in reality), label/PIN/threshold/concurrency config |

## 4. Talks to (edges)

- Rules → **Ordering workspace** read-only card + **Agent run** ladder (A2-18).
- Concurrency default → workspace tier preset; per-site hard cap stays above any knob (invariant).
- Label size → Receive printable sheet + Part detail label preview.
- PIN → Login. Keys never client-side (env vars per global standards).
- Reorder threshold semantics shared by Dashboard low/out, Inventory Stock facet, Shelves dots.

## 5. Round-2 changes

### R2-28 — Settings expansion 🟢

Client's list, mapped:
- **"Add multiple accounts for expense tracking"** → new owner-only card **Expense accounts**:
  add/rename/deactivate accounts (name + type `cash / bank / UPI`); expense entries pick an account
  (`smark_expenses.account_id`); charts can split by account (feeds R2-21, fields per Q-09).
- **"Ability to add employees"** → already delivered by the R2-01 **Users & roles** card (below) —
  no new work, confirmed.
- **"Ability to add rules"** → already baseline (**Standard search rules** card, add/remove) —
  confirmed.
- **"Add keys for websites to order from"** → the Distributors card becomes **addable**: "+ Add
  distributor" (name · site URL · method REST-with-key / browser-agent · API key server-side).
  New sites appear in every BOM's sequence editor (default OFF) and use the BrowserDriver unless
  they have an API. Baseline's fixed-5 list is now just the seed set.

### R2-01 — Users & roles card (owner-only) 🟡

New card, visible to `owner` role only (first owner account seeded at setup):

- **User list:** display name · username · role chip (owner / employee / accountant) · active toggle.
- **Add user:** display name + username + initial password + role picker → creates the Supabase Auth
  account + `smark_app_users` row. Client said "owner can add the employees" — planned as owner can
  add **any** role (employee AND accountant; second owner allowed unless Q-01 says otherwise).
- **Manage:** reset password (owner sets a new one — no email flow, users may not have email),
  deactivate (blocks login, keeps history rows intact — users are never hard-deleted because
  movements/events reference them).
- **App PIN card (baseline §2) is superseded** by this card — final fate of any quick-lock → Q-02.
- Whether `accountant` can see this Settings screen at all → part of the Q-01 matrix.

## 6. Open questions on this tab

- **Q-01** — access matrix decides which Settings sections employee/accountant can even see.
- **Q-02** — PIN/quick-unlock keep-or-kill.
