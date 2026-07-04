# MANUAL-TESTING.md — the hands-on pass before shipping to the client

> Everything the automated gate can't judge: real hardware (phone camera, barcode gun, label
> sheets), real files, real judgment ("does this feel right?"), and the live cloud wiring.
> Work through it top to bottom; log every issue in **`docs/TESTING-FINDINGS.md`** (one entry per
> problem, even tiny ones) — Claude consumes that file to drive the fix rounds.
>
> The AI ordering pipeline has its own dedicated doc: **`docs/AI-ORCHESTRATION.md`**.

## Priorities — where your time matters most

- **P0 — automation can never touch this**: real devices, printed paper, live keys, look-and-feel.
- **P1 — automation covers the mechanics, you judge the experience**: flows pass in Playwright,
  but only you can say "an employee will understand this."
- **P2 — heavily auto-tested; spot-check only**: 834 unit/integration tests + 166 e2e assertions
  already guard these. Don't burn hours here.

## 0. Setup (10 min)

```powershell
bunx supabase start          # local stack (Docker running first)
bunx supabase db reset       # migrations + seed
bun run scripts/seed-dev-users.ts       # owner / employee / accountant logins
bun run scripts/seed-canonical-demo.ts  # shelves A-D, 9 boxes, SMK-000101 family
bun run dev                  # app on http://localhost:3000
```

Logins: `owner / Owner@12345` · `employee / Employee@12345` · `accountant / Accountant@12345`.
**Phone testing:** your phone must reach the dev machine — `next dev` prints a Network URL
(e.g. `http://192.168.x.x:3000`); camera needs HTTPS or localhost, so for camera tests on the
phone use `bunx ngrok http 3000` (or any https tunnel) — the scanner shows its "insecure context"
fallback on plain http, that's expected, not a bug.

---

## 1. P0 — Real hardware & real-world

### 1.1 Camera scanner (on your actual phone)
- [ ] `/scan` → Camera: point at a printed ESD QR → beep + vibrate + green flash, part card opens.
- [ ] Same code held steady → does NOT re-trigger for ~3s (dedupe).
- [ ] Big-Box QR → box card with live contents.
- [ ] Torch button appears in a dark room and actually lights (Android Chrome).
- [ ] Header camera button: scan a part label from ANY screen → jumps straight to the part.
- [ ] Header camera with a random barcode (any grocery item) → results panel, not a crash.
- [ ] Receive → Top up → camera → scan label → part found, qty add works.
- [ ] Deny camera permission → manual-entry fallback appears and works.
- [ ] Scanner works in the installed PWA (see 1.4), not just the browser tab.

### 1.2 HID barcode gun (if you have one)
- [ ] `/scan` with the code input focused: gun-scan an ESD label → resolves instantly (the burst
      + Enter path). Type-speed humans don't trigger it accidentally.
- [ ] Gun-scan into the header search field → same resolve.

### 1.3 Labels on real paper
- [ ] Receive → create a new part → label queued. Queue 10+ labels (mix ESD + one Big-Box).
- [ ] Print sheet → PDF downloads → **print on an actual Avery L7651 sheet (38×21mm, 5×13)** →
      alignment sits inside the stickers (top row, bottom row, edges).
- [ ] Printed QR actually scans from 10–20 cm with the phone (print quality/quiet zone).
- [ ] Queue marks "printed" after; top-up NEVER offers a reprint (print-rule invariant).

### 1.4 PWA install & offline
- [ ] Android Chrome: login page shows install prompt → install → standalone app, correct icon +
      name.
- [ ] iOS Safari (if available): share-sheet instructions card shows.
- [ ] Airplane mode: app shell still opens; `/scan` take-out queues with the "N queued" banner;
      back online → syncs, movement appears with correct actor/time.
- [ ] Phone-sized sanity sweep: Dashboard, Inventory, a part drawer, Shelves, a box, Cart, a
      project hub, Daily, Expenses — no horizontal scroll anywhere, nothing unreachable.

### 1.5 Real client files
- [ ] Import the real `Stock List.xlsx` via `bun run scripts/import-stocklist.ts` against LOCAL →
      spot-check ~10 parts across different sheets: category, value/voltage split (`0.1µF/50V` →
      two fields), MPN, qty. Check the needs-review flags make sense.
- [ ] Onboarding queue shows the imported no-location parts → assign Shelf→Box→ESD for a few →
      labels queue.
- [ ] Upload real `TMCS_96x32_Matrix_V1.2.xlsx` and `GCU_V1.1_BOM.xlsx` as BOMs in a project →
      line counts match the sheets, reconcile statuses look sane.

## 2. P1 — Full flows, your judgment

Run each as the role named. You're judging clarity, speed, and "would a non-technical person
survive this" — the mechanics are already machine-tested.

### 2.1 The inventory day (employee)
- [ ] Login → dashboard makes sense at a glance (stats, recent movements).
- [ ] Find a part 3 ways: inventory facets (Category+Voltage), search text, scan. Which felt
      fastest? Any facet counts look wrong?
- [ ] Part drawer: specs, locations, living-record timeline — is the history READABLE?
- [ ] Take out 5 via scan → undo from the toast → qty restored everywhere (drawer, inventory,
      dashboard movement feed).
- [ ] Shelves → a box → guided audit: count 3 ESDs (one with a deliberate wrong qty) → variance
      logged as audit-tagged adjust, `last audited` stamp updates, partial audit resumable.
- [ ] Receive all three cards: new part (with a custom field + watch the duplicate guard fire on
      a near-match), top-up (no label offered), put-away empty state.
- [ ] Bulk takeout from a project BOM ×2 builds — location chips route a sane walk, finish logs
      everything, "To order →" for misses.

### 2.2 The project day (owner)
- [ ] Create project → phase timeline: add 4 phases + a parallel row + a buffer + a footnote;
      advance the active phase; check progress % and on-track chip move sensibly; edit a date →
      version bumps + change logged.
- [ ] BOMs: upload one + create one in-app (add a custom column — does the grid feel usable?);
      build qty ×10 → watch reconcile flip lines to to-order.
- [ ] Team: assign the employee; Documents: upload/download/delete; Notes & tasks: one of each
      type, task with assignee+due, 15-min edit window, "share to portal" toggle.
- [ ] Archive → read the warning text as if you were the client — is it scary-clear? → archived
      project vanishes from pickers, cart demand released → unarchive restores.
- [ ] Portal: copy share link → open logged-out on the phone → timeline + progress + ONLY shared
      items; post a comment → owner bell rings; regenerate token → old link dead. **Hunt for
      leaks: any ₹, qty, internal notes visible anywhere on the portal?**

### 2.3 The money day (owner + accountant)
- [ ] Cart: manual add, edit qty/price, the demand breakdown chips read right.
- [ ] Shortfall: with the seeded 500-avail part demanded 400+200 across two projects, the auto
      line says exactly 100. Dismiss it → bump demand higher → it resurrects.
- [ ] Checkout: select lines from 2 distributors → grouped correctly → blocked without order
      numbers → paste numbers → orders created + DRAFT expenses appear + owner notification.
- [ ] Receipt: upload any PDF/image to an order → "Extract prices" (mock mode: returns the fixture
      — the flow is what you're testing) → confirm dialog maps lines → prices fill.
- [ ] Mark arrived (partial first) → Receive put-away → last price stamped on the part,
      `price_change` event in the living record, dashboard inventory value moves.
- [ ] Expenses as accountant: add/edit entries (this is the ONE place accountant writes),
      confirm a draft, charts match the entries you just made, export CSV opens clean in Excel.
- [ ] Daily reports: employee clock-in→project→clock-out→hours prompt; owner sees team + expenses
      section; employee sees ONLY self and NO expenses; accountant read-all. Day export.

### 2.4 Role-matrix spot checks (15 min, one login each)
- [ ] Employee: no Expenses anywhere (nav, More sheet, direct URL bounce), no Settings, no AI
      memory approve.
- [ ] Accountant: read-only everywhere (no Take out / Add / checkout buttons), Expenses fully
      writable.
- [ ] Owner: Settings → create a real user, reset their password, deactivate → they're locked out
      mid-session.

### 2.5 Settings & AI memory (owner)
- [ ] Search rules: add a custom rule → shows read-only in the ordering workspace; the Package
      rule has NO remove control.
- [ ] Distributors: add a fake one → appears in BOM sequence editors, default OFF.
- [ ] Label size, low-stock mode, concurrency default, retire a remembered custom field →
      Receive stops auto-rendering it.
- [ ] AI memory: approve a suggested rule → version bumps + digest diff line; reject; retire.

### 2.6 AI ordering pipeline — mock mode first, then live
Follow **`docs/AI-ORCHESTRATION.md`** — it has the full map + experiments. Headline sequence:
- [ ] Mock run end-to-end (no keys): workspace → run console streams lanes → review persists →
      add to cart. Judge the console: is the narration/status readable? stale-run banner on ×N
      change?
- [ ] Live run (keys set, cost-capped): ONE small BOM, watch spend on the run card + AI spend
      meter in Expenses.

## 3. Cloud wiring verification (your `.env.cloud.local`)

- [ ] Supabase cloud: apply seed (ordering rules/distributors — currently EMPTY there), create the
      real owner account, verify login against cloud from a deploy/preview (NOT by pointing
      `.env.local` at cloud — that breaks the test suites; it's documented in the env file).
- [ ] R2 live proof: shell with `CLOUDFLARE_R2_*` set → `bun test tests/integration/storage-r2-live.test.ts`
      → green = upload/download/signed-URL round-trip confirmed. Then one real label-sheet PDF and
      one project document through the UI on a cloud-pointed build.
- [ ] Anthropic: set `CLAUDE_MODEL_MASTER` / `CLAUDE_MODEL_ITEM` (currently EMPTY — see the
      orchestration doc for what happens when unset) before any live run.

## 4. Recording what you find

Open **`docs/TESTING-FINDINGS.md`** side-by-side while testing. One entry per issue — screenshot
paths welcome (drop them in `docs/testing-screenshots/`). Severity guide is in that file. When
you're done (or daily), tell Claude "process the findings" and the fix rounds start from exactly
what you wrote.
