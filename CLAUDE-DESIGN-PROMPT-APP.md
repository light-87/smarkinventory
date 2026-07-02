# SmarkStock — Claude Design Prompt (Clickable App Prototype)

**How to use this file:** open Claude Design, **attach the design files and logos from this folder**
(`DESIGN.md`, `theme.css`, `variables.css`, `tokens.json`, and `assets/*`), then paste the **PROMPT
block** at the very bottom (§12). Everything above the block is context so you — and Claude Design —
know *what* to build and *why* each choice was made.

> This is a **different deliverable** from `CLAUDE-DESIGN-PROMPT.md`. That file builds a *static
> marketing proposal page*. **This file builds a *clickable product prototype*** — a real-feeling,
> multi-screen app the client can click through, with a PIN login and mock data from Smark's own
> spreadsheets. Same design system, completely different artifact.

---

## 1. What we're building

**SmarkStock** — an inventory + AI-ordering system for **Smark Automation** (a small Indian
electronics / PCB-assembly manufacturer). This prototype is the **clickable demo** shown to the
owner: it must *look and feel like the finished product*, with every screen navigable and the hero
"AI ordering" flow animating like it's really working.

**Output format — read carefully:**
- A **self-contained, static, clickable HTML app.** Prefer a **single `index.html`** with all CSS
  and JS inline (or a tiny `styles.css` + `app.js` + `mock-data.js` beside it). **No build step, no
  framework, no server** — it must run by double-clicking the file.
- **Multi-screen, hash-routed single page** (`#/dashboard`, `#/inventory`, `#/order`, …). Clicking
  the left nav swaps the view. The browser back/forward buttons work.
- **All data is baked into `mock-data.js`** (a plain JS object). **No network calls.** The AI
  ordering run is **simulated/scripted** (see §8) — it *looks* live but reads from the mock script.
- **1-PIN login** is a single JS constant at the top (`const APP_PIN = "1947"`). Gate the whole app
  behind it. (In the real app this becomes an `APP_PIN` env var — leave a `// TODO: env` comment.)
- **Mobile-first PWA feel**: everything works at **360px** width (Android minimum); the left nav
  collapses to a bottom tab bar on small screens. Touch targets ≥ 44px. No horizontal scroll.

**This is a prototype, not production.** Buttons can be optimistic, forms don't need validation, and
the "AI" is scripted. But it must be *cohesive and premium* — a real product, not a wireframe.

---

## 2. Who it's for (tone)

The audience is a **non-technical Indian business owner** and his **technicians**. The parts data is
inherently technical (MPNs, packages, values) — keep that authentic — but every label, empty state,
and helper line should be **plain, confident English**. No jargon in the chrome; jargon only where it
*is* the data (a part number is a part number).

---

## 3. The location & QR model (read before building — it drives several screens)

- **Location is 3 levels:** **Shelf → Big Box → ESD plastic.**
  - **Shelf** (A, B, C, D) — a physical shelf.
  - **Big Box** — a named container on a shelf with a **simple category** (Capacitors, Resistors, ICs,
    Modules, Power, Connectors). It holds many ESD plastics and has **its own QR**.
  - **ESD plastic** — the small anti-static box holding **one part** + its quantity; it carries the
    **part's QR**.
- **Two smart QR labels** (a QR **plus** human-readable text — never a bare code):
  - **ESD-plastic (part) label:** QR(PID) + `PID · value · package · MPN · category`
    (e.g. `SMK-000101 · 0.1µF/50V · 0603 · CL10B104MB8NNNC · Capacitor`).
  - **Big-Box label:** QR(box id) + `box name · category · item-type count · shelf`
    (e.g. `BOX C-04 · Capacitors · 38 types · Shelf B`) → scanning shows **live contents**.
- **One QR per box, never per unit** (10 pieces = one ESD label, not 10). The two interlock: scan an
  ESD plastic → "which big box/shelf am I in"; scan a big box → "everything I contain."
- **A part has a growing "living record":** every order/delivery **appends** an entry (distributor +
  link, why/project, delivered date, qty, unit price, who) shown as a **History timeline** on the part
  page. On receiving, an **existing part tops up its ESD plastic with NO reprint**; only a **new part
  prints a label**.

---

## 4. Look & feel — locked (follow the attached design system exactly)

Follow `DESIGN.md` + `tokens.json` + `theme.css` + `variables.css`. In one line: **a midnight,
code-editor aesthetic — a single near-black canvas, monochrome surfaces defined by hairline borders
(NO shadows, NO gradients), tight geometric type, and a single rationed accent.** Think
Supabase / Vercel / Linear / Railway — but this is **Smark's own product**.

**The one deliberate change from the Supabase reference: the accent is SMARK orange `#f57d05`,** used
everywhere the reference uses phosphor green. Ration it to ~**one element per region** (a primary
button, one active nav item, a low-stock flag, a focus border). Everything else is grayscale.

### Locked palette

| Role | Value |
|------|-------|
| Page canvas (the only background) | `#121212` Obsidian |
| Elevated / nested surface (popovers, hover, active row) | `#242424` Ash |
| Card & component border (most-used) | `#2e2e2e` Charcoal |
| Input border / hairline divider | `#393939` Slate |
| Icon outlines / line-art stroke | `#4d4d4d` Graphite |
| Primary text / labels | `#fafafa` Snow |
| Secondary text / nav | `#b4b4b4` Silver Mist |
| Tertiary text / captions / metadata | `#898989` Smoke |
| **Accent — CTA fill, active nav, low-stock flag, focus border, brand icon** | **`#f57d05` SMARK Orange** |
| Accent — hover / pressed border on CTA | `#c25e02` |
| Accent — inline link / textual reference | `#ff9a3c` |

**Status colors stay inside the grayscale + orange discipline** — do not introduce red/green/yellow.
- *Active / in-stock* → normal text, no special color.
- *Low stock / out of stock / needs attention* → **orange** text or a 1px orange border on the chip.
- *NRND / EOL / obsolete part status* → `#898989` Smoke (muted), never red.
- *Recommended ordering option* → a **1px orange border + orange "Recommended" pill**, not a fill.

### Type
- **Circular** (substitute **Inter** or **Manrope**) for *everything* — nav, body, buttons, headings.
  Weights **400 and 500 only — never 600/700.** Headlines are 400 (deliberate anti-bold); 500 is the
  loudest voice, for emphasis and button labels. Uniform letter-spacing **-0.007em** at all sizes.
- Scale: caption 12 · body-sm 14 · body 16 · subheading 18 · heading-sm 24 · heading 36 · display 72.
- **JetBrains Mono** (or Source Code Pro) **only** for part identity: PIDs (`SMK-000101`), MPNs
  (`CL10B104MB8NNNC`), LCSC codes (`C14663`), barcodes, prices in tables. **Never** for body copy.

### Shape & elevation
- Radius vocabulary is strict: **buttons/tags/chips = 9999px (pill)**, **cards/panels = 16px**,
  **inputs/table-wrappers = 8px**. Nothing else.
- **No box-shadows. No gradients.** Elevation is a 1px `#2e2e2e` border on the `#121212` canvas; a
  hovered/active surface lifts to `#242424`.
- Base spacing unit 8px. **This is a dense app, so run tighter than the marketing page:** card
  padding 16–24px, section/row gaps 12–24px, page content max-width ~1280px with a persistent left
  nav. Input focus = the **orange border itself** (1px, no glow ring).

### Illustration / icons
- Thin-stroke (1.5px) **line-art** only: shelf / big-box / ESD schematics, network nodes, wireframe
  glyphs in `#4d4d4d` on `#0d0d0d`, with occasional small **orange** accent dots. No photography.
- Icons: thin outlined, monochrome (`#fafafa`/`#b4b4b4`); orange reserved for the active/brand icon.
  A small consistent icon set (Lucide/Feather style) is fine.

---

## 5. Brand assets (in `assets/` — use these, don't invent a logo)

| File | Use |
|------|-----|
| `assets/smark-logo-on-dark.svg` | Login screen, and anywhere a full logo appears on the dark canvas |
| `assets/smark-mark.svg` | The **collapsed left-nav mark** and app-icon corner (it has a dark element — recolor that element to `#fafafa` on the dark canvas) |
| `assets/smark-logo-on-light.svg` | **Only** inside a printable **QR label sheet / PDF-style** surface (light background) |
| `assets/smark-app-icon.png` | The PWA app-icon touch in any phone-frame flourish |

Product name in the UI: **"SmarkStock"** (wordmark sits next to the SMARK mark in the nav). Optional
tagline for the login screen: *"Every part, every box — one tap away."*

---

## 6. App shell (persistent chrome around every screen)

- **Left nav rail** (collapses to a **bottom tab bar** ≤ 768px): SMARK mark + "SmarkStock" wordmark
  at top; nav items with thin icons — **Dashboard · Inventory · Shelves · Scan · Order · On-order ·
  AI Memory · Settings**. Active item: orange icon + `#fafafa` label + a 2px orange left-edge marker.
  Inactive: `#b4b4b4`. 1px `#2e2e2e` right border separates rail from content.
- **Top bar** (sticky, 56–64px, 1px `#2e2e2e` bottom border): screen title on the left; a **global
  scan input** in the center-right (mono placeholder `Scan or type a code…`, orange focus border);
  a round **PIN avatar** far right (initials `SA`) with a small dropdown (Lock, Settings).
- **Content area**: `#121212`, max-width ~1280px, comfortable gutters, the active view.
- **Hash routing**: each nav item maps to `#/route`. Back/forward work. Default route after login is
  `#/dashboard`.

---

## 7. Screens to build (16 — build all; M = must-have, N = nice-to-have)

Build each as a full view inside the shell. Use the **mock data in §8** and the **run script in §9**.

### 7.1 PIN Login (M) — `#/login`
Centered card (16px radius, 1px `#2e2e2e`, 24px padding) on the bare `#121212` canvas (no nav yet).
`smark-logo-on-dark.svg` at top, tagline in `#b4b4b4`, then **four mono PIN boxes** (8px radius, 1px
`#393939`, focus → orange). An orange pill **"Unlock"**. Wrong PIN → the row **shakes** and a
`#ff9a3c` "Incorrect PIN" line appears. Correct PIN (`1947`) → route to `#/dashboard`. Small footer
line: *"Runs on Smark's own Vercel · Supabase · Claude."*

### 7.2 Dashboard (M) — `#/dashboard`
The "this is real" landing. A row of **stat cards** (each `#121212`, 1px `#2e2e2e`, 16px radius,
number in 36px/400, label in 12px `#898989`): **Total parts**, **Distinct SKUs**, **Low stock**
(number in orange), **Out of stock** (orange), **On order**, **Movements today**. Below, a 2-column
layout:
- Left: **Recent movements** list (rows: time · part PID mono · ±qty chip · reason `pick`/`receive` ·
  big-box tag). Orange only on the take-out rows' minus chip.
- Right: **Agent activity** strip — one *running* run ("TMCS_96x32 · 7 items · 4 done…" with a thin
  orange progress bar) and one *completed* run; a small **project usage** mini-bar list (Power
  Breezer, DAQ, IR_RGB, GCU) as horizontal bars in `#4d4d4d` with orange caps.

### 7.3 Inventory List + Deep Filter (M) — `#/inventory`
The depth screen. **Left filter rail** (~240px, 1px `#2e2e2e` divider) with collapsible facet groups
and live counts: **Category** (Capacitor, Resistor, IC/ADC, IC/DAC, Inductor, Module, SMPS,
Connector…), **Package** (0402, 0603, 0805, 1206, SOT-23-6, MSOP8, 32LQFP…), **Value**, **Tolerance**,
**Voltage**, **Dielectric** (X7R/X5R/C0G), **Distributor** (LCSC, Digikey, Mouser, element14, RS,
Unikey), **Project**, **Stock level** (In stock / Low / Out), **Part status** (Active/NRND/EOL),
**Location** (Shelf / Big Box). A **search field** pinned above the table (mono-friendly). The
**table**: columns `PID` (mono) · `MPN` (mono) · `Value` · `Package` · `Category` · `Qty` (pill chip) ·
`Location` (tag like `Shelf B · Box B-12`) · `Status`. **Low-stock rows** get an orange left tick and
orange qty chip. Row → opens Part Detail. Sticky header, zebra via `#161616` alt rows (subtle), hover
row → `#242424`. Show a result count ("Showing 64 of 64 parts") and active-filter chips that remove.

### 7.4 Part Detail + QR + History (M) — `#/part/:pid`
Open as a **right-side drawer** (480px, slides over the list) or a full page on mobile. Header: PID
(mono, 24px), MPN (mono), manufacturer, and a **status pill**. A **spec grid** (2-col key/value:
Value, Package, Tolerance, Voltage, Dielectric, Part status, Datasheet link in `#ff9a3c`). A
**Locations table** — `Shelf · Big Box · ESD · Qty · Last counted` (a part may sit in more than one
ESD plastic). A **QR block** rendering the **ESD-plastic smart label**: a real QR encoding the **PID**
(tiny inline QR generator if easy, else a crisp QR-style SVG) + the label text
`SMK-000101 · 0.1µF/50V · 0603 · CL10B104MB8NNNC · Capacitor` in mono, beside a **"Print label"**
ghost button. A **History timeline** — the *living record* that visibly **keeps growing**: a vertical
list of events like `received 713 · LCSC · GCU · ₹0.40 · 20 Jun`, `picked 145 · TMCS_96x32 · 01 Jun`,
`received 2000 · LCSC · TMCS_96x32 · ₹0.42 · 12 May` — each showing distributor/link, project, qty,
price, and who. Footer actions: orange **"Order more"** (routes to Order with this part pre-added) and
ghost **"Adjust qty"**.

### 7.5 Shelf / Big-Box Browser (M) — `#/shelves`
The physical mental model — three levels: **Shelf → Big Box → ESD plastic (part)**. A **visual grid of
shelves** (A, B, C, D) as line-art tiles; each shelf expands to its **big boxes** (`B-05`, `B-12`, …)
as tiles showing **box name · simple category · item-type count**, with an **orange dot if any part
inside is low**. Click a big box → a panel with its **own Big-Box QR** (encodes the box id, for the
printed Big-Box label) and a **live contents** list (each ESD plastic: PID · MPN · qty). Breadcrumb
`Shelves / Shelf B / Box B-12`. Caption: *"Scan a big box to see everything inside."*

### 7.6 Add / Receive Stock + QR Labels (M) — `#/receive`
Two tabs:
- **Add a part**: a **"Paste an MPN"** input → an **AI-normalize panel** (scripted) that, after a
  ~700ms "Looking up…" shimmer, auto-fills Value / Package / Manufacturer / Part status / Category /
  Datasheet from the MPN (use `CL10B104MB8NNNC` → 0.1µF/50V/X7R/0603/Samsung as the canned example).
  Then a **suggested storage** row — Shelf ▾ · Big Box ▾ (defaults to the category's box, e.g.
  *"→ Box B-12 · Capacitors · Shelf B"*) · Qty — and **"Save & print ESD label."**
- **Receive against an order**: pick an on-order line → enter arrived qty. The panel **branches on
  whether the part already has a QR**:
  - **Existing part** → *"This part already has a QR on its ESD plastic in **Box B-12**. Add 10 — no
    new label."* Tops up the qty and **appends to the History timeline**.
  - **New part** → *"New part — suggested **Box C-04 · Modules · Shelf C**. Print 1 ESD label."*

Below, a **printable label sheet** preview on a light (`#fafafa`) document surface (use
`smark-logo-on-light.svg`) showing **both smart-label designs**: an **ESD-plastic label** (QR +
`SMK-000101 · 0.1µF/50V · 0603 · CL10B104MB8NNNC · Capacitor`) and a **Big-Box label** (QR +
`BOX C-04 · Capacitors · 38 types · Shelf B`). A **"Batch generate for existing stock"** entry point
opens a **"needs data / location" queue** ("12 parts imported from Stock List need a location") that
walks the user through assigning **Shelf → Big Box → ESD** and printing ESD labels (+ a Big-Box label
per new big box). This is the onboarding story for the ~2000 existing parts.

### 7.7 Scan / Take-out + Add (M) — `#/scan`
The everyday loop. A **big focus-trapped scan input** (mono, orange focus, auto-refocuses) with a
**"Simulate scan"** button that injects a code. Two scan targets:
- **ESD-plastic (part) QR** → show the **part card** (PID, MPN, value, current qty, its Shelf · Big
  Box location), a **qty stepper**, and two big buttons — orange **"Take out"** and ghost **"Add"**.
  Every action drops a **prominent Undo toast** ("Took out 5 × SMK-000101 from Box B-12 · **Undo**")
  that visibly reverses the qty.
- **Big-Box QR** → open its **live contents** (parts + qty inside), with **"Count / audit"** and
  **"Receive into this box"** actions.

A small **camera-frame placeholder** (line-art viewfinder) sits beside the input to imply phone-camera
scanning.

### 7.8 Bulk Pick from BOM (M) — `#/pick`
The differentiator. **Upload or paste a BOM** (or pick sample `GCU_V1.1`) → a table resolves each
line to its **Shelf · Big Box · ESD** and a **qty-to-pick**; each row has a checkbox. A **progress
bar** ("6 of 18 picked") fills as rows are checked. Rows that aren't in stock show an orange **"To
order"** tag linking to the Order flow. A **"Finish pick"** button gives a one-pass summary.

### 7.9 BOM Upload & Reconcile (M) — `#/order` (step 1)
The front door to ordering. Top: a **"Download template"** ghost button (implies an `.xlsx` template)
and an **upload dropzone** ("Drop your filled template, or pick a sample"). Picking **`GCU_V1.1`** or
**`TMCS_96x32`** loads its parsed lines into a table (columns: `#`, `Reference` mono, `Qty`, `Value`,
`Footprint` mono, `MPN` mono, `LCSC PN` mono). Show the **plain-English priorities read from the
sheet** in a small quoted card (e.g. *"Urgent prototype run — prioritise availability over lowest
cost; prefer LCSC for passives."*). Then a **split**: **In stock** (each line with a `Shelf · Big Box`
tag + available qty) vs **To order** (the rest). Show the real split as a headline: *"TMCS_96x32 —
122 lines · 48 in stock · 74 to order."* A big orange **"Set up ordering →"** advances to step 2.

### 7.10 Ordering Workspace (M) — `#/order/setup` (step 2)
Rules + knobs *before* the run. Three panels down the page:
1. **Distributor sequence** *(in-app, single per BOM)* — a **drag-reorderable** vertical list of
   pill rows: `1 LCSC · 2 Digikey · 3 Mouser · 4 Element14 · 5 Unikey`, each with a drag handle and
   an on/off toggle, plus a ghost **"+ Add site"** row. A caption: *"The agents try sites in this
   order."*
2. **Priorities (plain English)** — an **overall** textarea prefilled from the sheet, plus the
   **per-line notes** shown inline in a compact list (`C1 220µF/50V — "cheapest ok"`). Caption:
   *"The AI reads these in your own words."*
3. **Standard search rules** *(read-only card)* — the fixed ladder as a numbered, locked list:
   `MPN → LCSC PN (if given, LCSC only) → Value (R: value/voltage, tol, wattage · C: value/voltage,
   X7R/X5R) → Package (must match) → Part status → Quantity → Lowest cost`. A muted note: *"Standard
   for every order · change in Settings."* Package row carries a small orange **"required"** pill.
4. **Agents per item** — a 3-stop segmented control **Economy · Balanced · Thorough**. Each stop
   updates a small live readout: *"~2 parallel agents · stops at first match · ~₹— per run · slower"*
   vs *"…all 5 sites compared · fastest · higher cost."* (Numbers can be placeholder.)

A big orange **"Run ordering"** at the bottom → routes to the Agent-Run Console and starts the script.

### 7.11 Simulated Agent-Run Console (M) — `#/order/run` — **the centerpiece**
This must feel *alive* (see §9 for exact timing). Layout:
- **Master header**: "🧠 Master agent — reading rules, BOM & inventory…" typing out, then collapsing
  to "Planned 7 searches · dispatched 7 item agents." A thin orange **progress bar** and a live
  `done / total` + **cost meter** (mono, ticking up) and **elapsed timer**.
- **Per-item lanes** (one card per to-order line): each starts `queued`, then animates through
  status chips — `Searching LCSC…` → `Checking Digikey stock…` → `Package match ✓` → `Comparing…` →
  `done` — so viewers watch the **priority ladder** execute, not just a spinner.
- As a lane resolves, its **comparison table** fills **row-by-row**: columns `Distributor` ·
  `Price` (mono) · `Stock` · `MPN match` (✓ exact / ≈ approx / ✗) · `Package match` (✓/✗) ·
  `Part status` · `Order link` (`#ff9a3c` "Open"). The **recommended** row lands last and **pulses
  orange once**, gaining a 1px orange border + "Recommended" pill.
- The **Economy/Balanced/Thorough** choice visibly changes the animation (Economy = 2 lanes active at
  a time, fewer rows; Thorough = all lanes at once, more rows, faster cost tick).
- A hidden-ish **speed toggle** (1× / 4× / Instant) and a **Replay** button so a live demo never
  stalls. When all lanes finish → a **"Review results →"** button (orange).

### 7.12 Order Review + Mark Ordered (M) — `#/order/review`
The decision + close-the-loop. One section per to-order line: the finished comparison table with the
**recommended row pre-selected** (radio), an editable **qty**, and a **"Mark ordered"** button that
(a) opens the order link in a new tab (mock `#`), (b) moves the line to On-order, (c) shows a running
**cart total** (mono) at the bottom. Each result row has a small **feedback affordance** — a comment
icon that opens a one-line input ("wrong package", "prefer LCSC", "we already stock this"). Submitting
feedback **immediately drops a "Suggested rule" onto the AI Memory screen** (close the loop in the
demo). A final ghost **"Save as PDF cart"** for flavor.

### 7.13 On-Order / Arrivals (M) — `#/on-order`
Status tracking. Lines grouped under **To order · Ordered · Arrived** headers (count per group). Each
row: part PID · MPN · distributor · qty · a status pill. An **"Mark arrived"** action opens a small
form that **branches**: an **existing part** → *"Adds to its ESD plastic in Box B-12 — no new label"*;
a **new part** → arrived qty + suggested Shelf/Big Box + *"print 1 ESD label."* Either way it creates
a **receive movement** and **appends to the part's History timeline**. Include a couple of lines
mid-flight so all three groups are populated.

### 7.14 AI Memory / Learned Rules (M) — `#/memory`
The "it gets smarter" story *and* the safety story. Two lists:
- **Suggested rules** (from feedback, awaiting review): each a row with the proposed rule, its source
  comment, and **Approve / Edit / Reject** buttons. Approving moves it to Active and bumps the version.
- **Active rules**: table `Scope` (Global/Category/Part/Project/Distributor) · `Subject` · `Rule` ·
  `Source feedback` · `Confidence` · a **Retire** action.
A **version selector** ("Rules v4 ▾") with a tiny **diff** view ("+ prefer LCSC for GCU 0.1µF caps").
A reassuring caption: *"These rules are advisory and fully reviewable. Nothing here trains or changes
the AI model — it just reads your saved preferences."*

### 7.15 Settings (N) — `#/settings`
Cards for: **Distributors & API keys** (rows with masked-key placeholders + a "Connected" pill for
Digikey/Mouser/element14, "Browser agent" for LCSC/Unikey), **Standard search rules** (the same
ladder, here *editable* — reorder/toggle), **PIN**, **Label size** (Avery-style dropdown),
**Low-stock thresholds**, **Concurrency defaults**, and **Connected accounts** badges (Vercel ·
Supabase · Claude) with the line *"You own these accounts."*

### 7.16 Global Scan Modal (N) — overlay
Triggered from the top-bar scan input anywhere: a small modal with a **camera viewfinder
placeholder** + the mono input; resolving a **part** code jumps to Part Detail, a **big-box** code
opens its contents. Reuse the §7.7 logic.

---

## 8. Mock data spec (`mock-data.js`) — seed with REAL Smark data

Bake a `MOCK` object. Below is the **authentic seed** (pulled from Smark's actual `Stock List.xlsx`
and BOMs). **Extend the `parts` array to ~60–80 items** by following the same patterns (more
capacitor values/packages, more resistor values, a few more ICs/inductors/connectors) so the
inventory and filters feel full. Keep MPNs/LCSC codes realistic.

```js
const APP_PIN = "1947"; // TODO: env APP_PIN in the real app

const MOCK = {
  shelves: [
    { code: "A", name: "Passives" }, { code: "B", name: "Passives / Caps" },
    { code: "C", name: "ICs & Modules" }, { code: "D", name: "Power & Connectors" },
  ],
  // Big boxes: named container on a shelf, with a simple category + its own QR (id = code).
  bigBoxes: [
    { code: "A-03", shelf: "A", name: "Resistors 0402/0603", category: "Resistor" },
    { code: "A-07", shelf: "A", name: "Resistors & Inductors", category: "Resistor" },
    { code: "B-05", shelf: "B", name: "Capacitors (bulk)",   category: "Capacitor" },
    { code: "B-12", shelf: "B", name: "Capacitors 0603",     category: "Capacitor" },
    { code: "C-01", shelf: "C", name: "ADC / DAC ICs",       category: "IC" },
    { code: "C-04", shelf: "C", name: "Data-converter ICs",  category: "IC" },
    { code: "C-09", shelf: "C", name: "Modules & Sensors",   category: "Module" },
    { code: "D-02", shelf: "D", name: "Power / SMPS",        category: "SMPS" },
    { code: "D-06", shelf: "D", name: "Connectors",          category: "Connector" },
  ],
  projects: ["Power Breezer", "DAQ", "IR_RGB", "WiFi_Module_Board", "TMCS_96x32", "GCU"],
  distributors: ["LCSC", "Digikey", "Mouser", "Element14", "Unikey"],

  // REAL parts. Each `location` = an ESD plastic inside a big box (the part's QR is on it).
  // status: active|nrnd|eol. A part may have >1 ESD plastic (rare bulk case).
  parts: [
    { pid:"SMK-000101", category:"Capacitor", value:"0.1µF/50V", dielectric:"X7R", pkg:"0603",
      mpn:"CL10B104MB8NNNC", lcsc:"C14663", mfr:"Samsung", status:"active", datasheet:"#",
      locations:[{shelf:"B",bigBox:"B-12",qty:2568},{shelf:"B",bigBox:"B-05",qty:400}],
      projects:["TMCS_96x32","GCU"], reorder:500,
      // living record — this is what "keeps growing" (§3)
      history:[
        {event:"received", date:"12 May", qty:2000, distributor:"LCSC", link:"#", project:"TMCS_96x32", reason:"BOM order", price:"₹0.42", by:"SA"},
        {event:"picked",   date:"01 Jun", qty:-145, project:"TMCS_96x32", by:"RT"},
        {event:"received", date:"20 Jun", qty:713,  distributor:"LCSC", link:"#", project:"GCU", reason:"top-up (existing box, no reprint)", price:"₹0.40", by:"SA"},
      ] },
    { pid:"SMK-000102", category:"Capacitor", value:"10µF/35V", dielectric:"X5R", pkg:"1206",
      mpn:"GRM319R6YA106KA12D", lcsc:"C92797", mfr:"Murata", status:"active",
      locations:[{shelf:"B",bigBox:"B-12",qty:480}], projects:["TMCS_96x32"], reorder:200 },
    { pid:"SMK-000103", category:"Capacitor", value:"100µF/63V", dielectric:"", pkg:"CAP-AE",
      mpn:"PCM1J101MCL1GS", lcsc:"", mfr:"Nichicon", status:"active",
      locations:[{shelf:"B",bigBox:"B-05",qty:22}], projects:["GCU"], reorder:25 },
    { pid:"SMK-000104", category:"Capacitor", value:"4.7nF", dielectric:"C0G", pkg:"0603",
      mpn:"C0603C472F5GACAUTO", lcsc:"", mfr:"KEMET", status:"active",
      locations:[{shelf:"B",bigBox:"B-05",qty:0}], projects:["GCU"], reorder:50 }, // OUT
    { pid:"SMK-000201", category:"Resistor", value:"0R", watt:"0.0625W", tol:"", pkg:"0402",
      mpn:"", lcsc:"", mfr:"", status:"active", locations:[{shelf:"A",bigBox:"A-03",qty:145}],
      projects:["DAQ"], reorder:100 },
    { pid:"SMK-000202", category:"Resistor", value:"0.01R/10mΩ", watt:"1W", tol:"1%", pkg:"1206",
      mpn:"LVT12R0100FER", lcsc:"", mfr:"Vishay", status:"active",
      locations:[{shelf:"A",bigBox:"A-07",qty:60}], projects:["Power Breezer"], reorder:20 },
    { pid:"SMK-000301", category:"IC / ADC", value:"16BIT SAR", pkg:"MSOP8",
      mpn:"AD7684BRMZ", lcsc:"", mfr:"Analog Devices", status:"nrnd",
      locations:[{shelf:"C",bigBox:"C-01",qty:1}], projects:["DAQ"], reorder:2 }, // LOW
    { pid:"SMK-000302", category:"IC / ADC", value:"24BIT ΣΔ", pkg:"32LQFP",
      mpn:"ADS124S08IPBSR", lcsc:"C2870171", mfr:"Texas Instruments", status:"active",
      locations:[{shelf:"C",bigBox:"C-04",qty:12}], projects:["DAQ","Power Breezer"], reorder:5 },
    { pid:"SMK-000303", category:"IC / DAC", value:"12BIT V-OUT", pkg:"SOT-23-6",
      mpn:"MCP4725A0T-E/CH", lcsc:"C144198", mfr:"Microchip", status:"active",
      locations:[{shelf:"C",bigBox:"C-04",qty:5}], projects:["IR_RGB"], reorder:5 },
    { pid:"SMK-000401", category:"Inductor", value:"2.2µH", current:"410mA", pkg:"0805",
      mpn:"CB2012T2R2M", lcsc:"C90311", mfr:"Taiyo Yuden", status:"active",
      locations:[{shelf:"A",bigBox:"A-07",qty:108}], projects:["WiFi_Module_Board"], reorder:40 },
    { pid:"SMK-000501", category:"Module", value:"3-axis compass", pkg:"—",
      mpn:"HMC5883L", lcsc:"", mfr:"Honeywell", status:"eol",
      locations:[{shelf:"C",bigBox:"C-09",qty:1}], projects:["DAQ"], reorder:1 },
    { pid:"SMK-000601", category:"SMPS", value:"5V / 700mA (3W)", pkg:"30×20.5mm",
      mpn:"SPS-3W5-5V", lcsc:"", mfr:"Smark", status:"active",
      locations:[{shelf:"D",bigBox:"D-02",qty:182}], projects:["Power Breezer"], reorder:50 },
    { pid:"SMK-000701", category:"Connector", value:"Micro USB B recept.", pkg:"TH",
      mpn:"USB3145-30-1-A", lcsc:"", mfr:"GCT", status:"active",
      locations:[{shelf:"D",bigBox:"D-06",qty:4}], projects:["WiFi_Module_Board"], reorder:10 }, // LOW
    // … extend to ~60–80 with more 0603/0805/1206 caps, 0R/1k/10k resistors, a few ICs, etc.
  ],

  // Two REAL BOMs. Include ~8–10 sample lines each; note the true totals for the headline.
  boms: [
    { name:"TMCS_96x32_V1.2", totalLines:122, inStock:48, toOrder:74,
      priorities:"Urgent prototype run — prioritise availability over lowest cost; prefer LCSC for passives.",
      lines:[
        { n:1, ref:"C1", qty:1, value:"220µF/50V", footprint:"CAP_AE_10x10.5", mpn:"", lcsc:"", note:"cheapest ok" },
        { n:2, ref:"C2,C3,C5,C6", qty:4, value:"10µF/35V", footprint:"C1206", mpn:"GRM319R6YA106KA12D", lcsc:"C92797", note:"" },
        { n:3, ref:"C4", qty:1, value:"330nF", footprint:"C0805", mpn:"", lcsc:"C107132", note:"LCSC only" },
        { n:12, ref:"C18,C34,C35…(145)", qty:145, value:"0.1µF", footprint:"C0603", mpn:"CL10B104MB8NNNC", lcsc:"C14663", note:"" },
        { n:18, ref:"C28,C29,C30", qty:3, value:"15µF", footprint:"C1411", mpn:"25TQC15MYFB", lcsc:"C139564", note:"" },
        // …
      ] },
    { name:"GCU_V1.1", totalLines:100, inStock:39, toOrder:61,
      priorities:"Standard production batch — lowest cost within trusted sites.",
      lines:[
        { n:1, ref:"C1", qty:1, value:"100µF/63V", footprint:"CAPAE1030X1050N", mpn:"PCM1J101MCL1GS", lcsc:"", note:"" },
        { n:3, ref:"C3,C69,C70,C75,C76", qty:5, value:"0.1µF/100V", footprint:"C0805", mpn:"GCM21BR72A104KA37L", lcsc:"", note:"" },
        { n:4, ref:"C4", qty:1, value:"4.7nF", footprint:"C0603", mpn:"C0603C472F5GACAUTO", lcsc:"", note:"" },
        // …
      ] },
  ],

  learnedRules: {
    version: 4,
    active: [
      { scope:"Category", subject:"Capacitor 0.1µF (GCU)", rule:"Prefer LCSC", source:"\"we always buy these from LCSC\"", confidence:"high" },
      { scope:"Part", subject:"C14663 / SMK-000101", rule:"Already stocked — don't reorder under 500", source:"\"we have 2500+ in Box B-12\"", confidence:"high" },
      { scope:"Distributor", subject:"Unikey", rule:"Only if genuinely cheaper AND in stock", source:"manual", confidence:"med" },
      { scope:"Project", subject:"Power Breezer", rule:"Automotive-grade parts only", source:"\"this goes in a vehicle\"", confidence:"high" },
      { scope:"Global", subject:"Package", rule:"Never substitute a different package", source:"manual", confidence:"high" },
    ],
    suggested: [], // feedback in the demo pushes items here
  },
};
```

---

## 9. Simulated agent-run script (make §7.11 feel alive)

Drive the console from a single scripted timeline — **no real timers of unknown length; use short,
jittered `setTimeout`s** so lanes finish out of lockstep. Suggested beats:

1. `t0` master header types: "Reading rules, BOM & inventory…" → `t+700ms` "Planning search
   strategy…" → `t+1500ms` "Planned 7 searches · dispatched 7 item agents." Lanes appear `queued`.
2. Each lane, staggered by **300–600ms**, flips to `searching` and cycles status chips through the
   **distributor sequence** on its own **jittered 700–2500ms** cadence: `Searching LCSC…` →
   `Checking Digikey stock…` → `Package match ✓` → `Comparing prices…` → `done`.
3. As each lane hits `comparing`, **append comparison rows one at a time** (every 250–500ms), each new
   `<tr>` briefly highlighted (`#242424`) then settling. The **recommended** row is appended **last**
   and **pulses orange once**.
4. **Meters**: increment the mono **cost counter** as each lane finishes; update `done / total`; run
   an **elapsed timer**.
5. **Knob honesty**: Economy → only 2 lanes `searching` at once (others stay `queued`), ~2 rows/table;
   Thorough → all lanes at once, up to 5 rows/table, faster cost tick.
6. **Controls**: a speed toggle **1× / 4× / Instant** scales all delays; a **Replay** button resets
   and re-runs. Respect `prefers-reduced-motion` → jump to the finished state instantly.
7. **Example lane data** (use real BOM lines): line `C1 220µF/50V` → LCSC ✓ in stock ₹— (Recommended),
   Digikey ≈ , Mouser ✗ package; line `C4 330nF (C107132)` → **LCSC only** (rule), one row; line
   `0.1µF C14663` → flagged **"Already in stock — 2568 in Box B-12"** instead of a buy table (shows
   the learned rule working).

---

## 10. Interactions & routing (what must actually work)

- **PIN gate** blocks everything until `1947`; Lock (avatar menu) returns to `#/login`.
- **Left nav / bottom tabs** switch views via hash; active state updates; back/forward work.
- **Inventory filters** actually filter the table; active-filter chips remove on click; row → Part
  drawer.
- **Scan / take-out / add** changes the shown qty and always offers **Undo** that reverses it;
  scanning a **Big-Box QR** opens its live contents.
- **Bulk pick** checkboxes advance the progress bar.
- **Order flow** is linear: `#/order` → `#/order/setup` → `#/order/run` (auto-plays script) →
  `#/order/review` → marking ordered moves lines to `#/on-order`.
- **Receiving** an existing part appends a row to that part's **History timeline** (no new label); a
  new part shows the "print ESD label" step.
- **Feedback on a result** creates a **Suggested rule** visible on `#/memory` (and approving it bumps
  the version). This loop is the "gets smarter" proof — make it visibly connected.
- Everything degrades gracefully at 360px (nav → bottom tabs, tables → horizontally scrollable cards
  or stacked rows, drawer → full screen).

---

## 11. Do / Don't

**Do:** ration orange to ~one element per region · pills for buttons/chips, 16px for cards, 8px for
inputs · Circular/Inter 400 for headings, 500 for emphasis · separate every surface with a 1px
`#2e2e2e` border · keep the canvas a single `#121212` · use the mono font **only** for part numbers,
codes, and prices · make every QR a **smart label** (QR + human text) · keep it **static &
offline-openable** with all mock data inline.

**Don't:** introduce any color beyond SMARK orange + the grayscale ramp (no red/green/yellow status) ·
use font weight 600/700 · add box-shadows or gradients · use radii outside {9999, 16, 8} · put orange
on large fills (it's punctuation) · show a QR per unit (one per box) · reprint a label for a part that
already has one · make any real network call · require a build step or server.

---

## 12. PROMPT — paste this into Claude Design (with the design files + `assets/` attached)

> Build a **self-contained, clickable HTML prototype** of **SmarkStock**, an inventory + AI-ordering
> app for **Smark Automation** (a small Indian electronics manufacturer). Output a **single
> `index.html`** (CSS + JS inline, or with a small `app.js` + `mock-data.js` beside it) that runs by
> **double-click — no build, no server, no network.** It is a **hash-routed single-page app** with a
> persistent left nav (collapsing to a bottom tab bar ≤768px) and a sticky top bar; **mobile-first**,
> everything works at 360px. Gate the app behind a **1-PIN login** using a JS constant
> `const APP_PIN = "1947"`.
>
> **Follow the attached design system exactly** (`DESIGN.md`, `tokens.json`, `theme.css`,
> `variables.css`): a Supabase/Vercel-style **midnight, code-editor aesthetic** — single `#121212`
> canvas, monochrome surfaces defined by **1px `#2e2e2e` hairline borders (NO shadows, NO gradients)**,
> **Circular** type (substitute **Inter**/Manrope; weights **400 & 500 only, never bold**; uniform
> -0.007em tracking), and a **single rationed accent = SMARK orange `#f57d05`** (hover `#c25e02`,
> link `#ff9a3c`) used only for primary buttons, the active nav item, low-stock/attention flags,
> input focus borders, and the one "Recommended" marker. Keep the rest grayscale: text
> `#fafafa`/`#b4b4b4`/`#898989`, borders `#2e2e2e`/`#393939`, icon stroke `#4d4d4d`, elevated surface
> `#242424`. **Status stays inside grayscale+orange — no red/green/yellow.** Radius vocabulary is
> strict: **pills 9999px for buttons/chips, 16px for cards, 8px for inputs.** Use **JetBrains Mono**
> **only** for part identity (PIDs like `SMK-000101`, MPNs like `CL10B104MB8NNNC`, LCSC codes like
> `C14663`, prices). Use the attached **`assets/smark-logo-on-dark.svg`** on the login and
> **`assets/smark-mark.svg`** in the nav; `assets/smark-logo-on-light.svg` only inside the light QR
> label sheet. Don't invent a logo.
>
> **Location is 3 levels: Shelf → Big Box (named + simple category, has its OWN QR) → ESD plastic
> (holds one part, carries the part QR).** Use **two smart QR labels** (QR + human-readable text): an
> **ESD-plastic label** (`PID · value · package · MPN · category`) and a **Big-Box label** (`box name ·
> category · item-type count · shelf`, which scans to live contents). **One QR per box, never per
> unit.** Every part has a **growing History timeline** (each order/delivery appends distributor+link,
> project, qty, price, date). On receiving, an **existing part tops up its ESD plastic with NO
> reprint**; only a **new part prints a label** and gets a suggested Shelf/Big-Box location.
>
> **Bake all data into a `MOCK` object** using the authentic seed provided (real MPNs, LCSC codes,
> shelves → big boxes → ESD plastics, the `TMCS_96x32` and `GCU_V1.1` BOMs, and learned rules); extend
> the parts list to ~60–80 items following the same patterns so filters and tables feel full. **No
> real network — the AI ordering run is simulated/scripted.**
>
> Build these **16 screens** inside the shell, all navigable: **(1)** PIN login (4 mono boxes,
> wrong-PIN shake); **(2)** Dashboard (stat cards with orange only on low/out, recent movements,
> agent-activity strip, project mini-bars); **(3)** Inventory list with a **deep left filter rail**
> (category, package, value, tolerance, voltage, dielectric, distributor, project, stock level,
> status, location) + a dense table (PID·MPN·Value·Package·Category·Qty chip·Location tag
> `Shelf B · Box B-12`·Status), low-stock rows flagged orange; **(4)** Part detail drawer with spec
> grid, **Locations table (Shelf · Big Box · ESD)**, a **QR block = the ESD-plastic smart label
> (QR + PID·value·package·MPN·category)** + Print label, and a **growing History timeline** (living
> record); **(5)** Shelf browser — **Shelf → Big Box → ESD**: big-box tiles show name·category·count
> (orange dot when low), and each big box has its **own QR + live contents** list; **(6)** Add/Receive
> stock with an **AI-normalize-from-MPN** panel (scripted) + **suggested storage**, a receive flow
> that **branches existing (no reprint, top up its ESD plastic) vs new (print 1 ESD label)**, and a
> **printable label sheet showing BOTH smart-label designs** (ESD + Big-Box) plus a **"batch generate
> for existing stock / needs-location queue"**; **(7)** Scan — an **ESD (part) QR** → part card + qty
> stepper + **Undo** toast; a **Big-Box QR** → live contents + count/receive-into-box; **(8)**
> Bulk-pick from a BOM (resolves each line to Shelf · Big Box · ESD, checkboxes + progress bar);
> **(9)** BOM upload & reconcile (**Download template** + dropzone, pick sample `GCU_V1.1`/`TMCS_96x32`,
> show plain-English priorities from the sheet, split **In stock** vs **To order** with the real
> 122/48/74 headline); **(10)** Ordering workspace — an in-app **distributor-sequence editor**
> (drag-reorder LCSC/Digikey/Mouser/Element14/Unikey, toggle, +add-site, single per BOM), a
> **plain-English priorities** area (overall + per-line, prefilled), a **read-only "Standard search
> rules" card** (MPN→LCSC→Value→Package(required)→Status→Qty→Cost), and an **agents-per-item**
> segmented control (Economy/Balanced/Thorough with a live cost/speed readout); **(11)** the
> **Simulated Agent-Run Console** — the centerpiece: a master-agent header that plans and dispatches,
> **per-item lanes** cycling through distributor status chips, comparison tables that **stream in
> row-by-row** (Distributor·Price·Stock·MPN match·Package match·Status·Link) with a **Recommended**
> row that pulses orange, live cost/`done-total`/timer meters, and a speed(1×/4×/Instant)+Replay
> control; **(12)** Order review + **Mark ordered** (recommended row pre-selected, qty, cart total,
> per-result **feedback** that spawns a Suggested rule); **(13)** On-order/Arrivals (grouped
> to-order·ordered·arrived; **Mark arrived** branches existing→no-label / new→print-label and appends
> to the part's History); **(14)** AI Memory / learned rules (Suggested with Approve/Edit/Reject,
> Active rules table, version + diff, "advisory — nothing trains the model"); **(15)** Settings
> (distributors & API-key placeholders, editable standard rules, PIN, label size, thresholds,
> Vercel·Supabase·Claude "you own these" badges); **(16)** a global scan modal (part → detail,
> big-box → contents).
>
> Make the order flow linear and the **feedback→Suggested-rule** loop visibly connected. Keep it
> cohesive, dense, and premium — a real product a client can click through, not a wireframe. **No
> pricing figures need to be real; no red/green/yellow; no shadows or gradients; one QR per box (never
> per unit); offline-openable.**
