# Login + App Shell

**Routes:** `#/login` + persistent chrome around every screen · **Spec:** FEATURES.md §2, PWA rules ·
**Prototype:** PIN block, rail/tab nav, top bar, global scan modal, toast system.

## 1. Purpose (baseline)

Gate the app with a 4-digit PIN (prototype parity; real app = Supabase Auth with Manager/Admin vs
Technician roles enforced by RLS). Provide the constant navigation + global scan entry so any code is
one action away from anywhere.

## 2. Current behaviour (as prototyped)

- **PIN login:** 4 digit boxes, auto-advance, backspace walks left, Enter submits, wrong PIN shakes +
  clears; success stores a session flag and routes to `#/dashboard`. Demo hint card optional.
- **Desktop (>768px):** left rail, groups — Overview (Dashboard, Inventory, Shelves), Operate (Scan,
  Pick, Receive), Ordering (Orders, On-order), footer (AI Memory, Settings). Active item: orange icon
  + left tick + dark pill. Orders stays active across `order / setup / run / review`.
- **Mobile (≤768px):** bottom tab bar with 5: Dashboard, Inventory, Scan, Orders, AI Memory. Other
  screens reachable via in-page links; rail hidden.
- **Top bar (every screen):** screen title, center **scan-or-type field** (Enter → opens global scan
  modal with the code), avatar menu (Settings, Lock). Lock clears session → login.
- **Global scan modal:** camera frame mock + code input; PID opens the part drawer, box code opens
  Shelves at that box, no match → toast.
- **Toasts:** bottom-center pills, optional **Undo** action (stock mutations) and dismiss ×.
- **Routing:** hash-based (`#/inventory`, `#/part/:pid`, `#/order/run`…); direct links work.
- **PWA (spec, not in prototype):** manifest, service worker, install prompt on THIS login page
  (Android `beforeinstallprompt` button; iOS add-to-home-screen card); 360px min width; 44px targets.

## 3. Data touched

| Read | Write |
|---|---|
| session/auth state; parts + boxes (code resolution) | session flag; later: Supabase Auth session |

## 4. Talks to (edges)

- Top-bar scan / modal → **Part detail** drawer or **Shelves** box view (CROSS-FEATURE A2-17).
- Avatar → **Settings**; Lock → **Login**.
- Roles (real app) gate: Settings edits + AI-Memory approvals = Manager only (A3 invariants).

## 5. Round-2 changes

### R2-34 — Global search (Ctrl-K) 🟢
Top-bar scan-or-type field generalizes: type anything → palette results across parts (PID/MPN/
value), projects, BOM names, PO numbers; scan codes keep resolving as before. Ctrl-K opens it
anywhere; mobile: magnifier icon in the header. pg_trgm/FTS indexes behind it.

### R2-36 — In-app notifications 🟢
Bell + unread badge in the header (mobile: on More sheet). Events: arrival marked, task assigned to
you, suggested rule awaiting approval (owner), low stock crossed, agent run finished, PO draft
expense awaiting confirm (owner). Per-role routing follows the matrix; rows in
`smark_notifications`, mark-read, deep links. WhatsApp channel = future.

### R2-01 — Real logins: username + password, 3 roles 🟢

Replaces the 4-digit PIN gate (baseline §2 "PIN login" is now superseded — PIN screen goes away,
see Q-02 for whether any quick-lock remains).

- **Login screen v2:** username + password fields (not email — users are non-technical; usernames
  like `suresh`), show/hide password toggle, error state on wrong credentials, same dark branded
  layout. PWA install prompt stays on this page (unchanged).
- **Auth backend:** Supabase Auth email+password under the hood; username maps to a synthetic email
  (`{username}@smark.internal`) so usernames stay the visible identity. Profile row in
  `smark_app_users` carries `username`, `display_name`, `role`.
- **Roles (3):** `owner` · `employee` · `accountant`. Supersedes FEATURES.md v1's Manager/Technician
  pair everywhere it's mentioned.
- **Session:** avatar menu now shows display name + role chip; **Lock → Logout** (ends Supabase
  session). Every mutation (movements, part events, receives, orders, feedback) records the real
  `user_id` instead of the hardcoded "SA".
- **Access control — MATRIX FINAL (Q-01 closed):**

  | Area | Owner | Employee | Accountant |
  |---|---|---|---|
  | Dashboard · Inventory · Shelves · Scan · Bulk takeout · Receive | full | full | read-only |
  | Projects (BOMs, runs, review, cart-add) · Cart & checkout | full | full | read-only |
  | Daily Reports | all people | **self only** | read all |
  | Expenses (+charts, AI spend) | full | hidden | **read + WRITE** (client amendment) |
  | AI Memory approve · Settings · user management | full | hidden | hidden |

  Nav/More-sheet items outside a role's column are hidden; RLS enforces the same matrix
  server-side (executable spec in TESTING.md). Client portal (R2-38) is a separate surface, not a
  role here.
- Owner-side user management lives in **Settings** (see `tab-settings.md` R2-01).
- **Q-02 closed:** no PIN anywhere; sessions persist per device; manual logout.

### R2-02 / R2-03 / R2-07 / R2-09 / R2-20 / R2-26 (ripple) — nav changes 🟢

- **Rail:** "Ordering" group + "Orders" item → **"Projects"** (`#/projects`); beneath it
  **Cart** (`#/cart`, was On-order — R2-09). New **"Team"** group with **Daily Reports**
  (`#/daily`, R2-07 — absorbed the planned Attendance entry). **Expenses** (`#/expenses`, R2-20)
  appears for the owner only. Operate group: "Pick" label → **"Bulk takeout"** (R2-26).
- Items outside a role's access (per Q-01 matrix) are hidden, not disabled.

### R2-22 — Mobile "More" tab 🟢

Bottom bar becomes **Dashboard · Inventory · Scan · Projects · More** (AI Memory leaves the bar).
**More** opens a bottom sheet listing every remaining tab the role can see: Shelves, Bulk takeout,
Receive, Cart, Daily Reports, AI Memory, Expenses (owner), Settings — icon + label grid, 44px+
targets. Deep links unchanged. This supersedes the earlier role-aware-5th-slot proposal and closes
the mobile-layout part of Q-01 (matrix still decides which items the sheet SHOWS per role).

## 6. Open questions on this tab

*(none — Q-01 and Q-02 closed; matrix table above is canonical)*
