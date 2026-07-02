# SmarkStock — Claude Design Prompt (Proposal + Static UI Mockups)

**How to use this file:** open Claude Design, attach the four design files and the logos from this
folder (`DESIGN.md`, `theme.css`, `tokens.json`, `variables.css`, and `assets/*`), then paste the
**PROMPT** block at the bottom. Everything above the block is context so you (and Claude Design)
know *why* each choice was made.

---

## 1. What we're building

A **client proposal** for **Smark Automation** — a small Indian electronics/automation-parts
manufacturer (PCB assembly, embedded systems; the ones behind Main Website / SMARK-Automations).
The proposal pitches **SmarkStock**: one system that does three things.

1. **Live inventory** — 200+ small parts tracked by **shelf → box → quantity**. Add/remove by
   barcode scan or by typing. A realtime inventory page.
2. **Smart ordering (not automatic)** — a technician pastes a product's parts list (BOM). The app
   splits it into **"In stock"** (each part shown with its box/shelf) and **"To order."** For the
   to-order list, the AI searches Smark's **preferred supplier sites first**, and only suggests an
   outside shop if it's **trusted AND genuinely cheaper.** Output is a clean **PDF cart**.
3. **AI brain** — Claude does the have/need matching, the supplier search, and drafts the PDF. It
   runs on **Smark's own Claude subscription**, so there are no extra AI bills. The client critiques
   the agent and it **improves over time** (saved rules, not model training).

**The whole system runs on the client's own Vercel + Supabase + Claude accounts → zero ongoing
dependency on the developer.** That reassurance is a selling point, not a footnote.

**Deliverable from Claude Design:** a single, long, **vertically-scrolling proposal page**,
presentation-style (stacked "slides"), with **static, non-clickable UI mockups** shown inside clean
device/browser frames. The mockups are illustrative — nothing needs to actually work.

> **No pricing anywhere.** Do not include any cost, ₹ figure, "investment," or pricing slide.

---

## 2. Look & feel — Supabase-style dark, personalized to SMARK

Follow the attached design system exactly (`DESIGN.md` + `tokens.json` + `theme.css` +
`variables.css`). In one line: **a midnight, code-editor aesthetic — near-black canvas, monochrome
surfaces defined by hairline borders (no shadows, no gradients), tight geometric type, and a single
rationed accent color.** Think Supabase / Vercel / Linear / Railway.

**The one deliberate change from the reference: the accent color.** The reference rations a single
*phosphor green* (`#3ecf8e`). We swap that for **SMARK's brand orange `#f57d05`** everywhere the
system uses green — primary buttons, one highlighted keyword per headline, active nav, small icon
accents, and input focus borders. This makes it read as **Smark's own product**, not a Supabase
clone, while keeping the exact same discipline (one accent, rationed to ~one element per region).
Everything else in the palette stays identical to the reference.

> If we ever want the pure-Supabase look instead, it's a global find-replace of `#f57d05` → `#3ecf8e`.
> For this proposal, **use orange.**

### Locked palette (from the design system, accent swapped to orange)

| Role | Value |
|------|-------|
| Page canvas (only background) | `#121212` Obsidian |
| Elevated / nested surface | `#242424` Ash |
| Card & component border (most-used) | `#2e2e2e` Charcoal |
| Input border / hairline divider | `#393939` Slate |
| Icon outlines / line-art stroke | `#4d4d4d` Graphite |
| Primary text / labels | `#fafafa` Snow |
| Secondary text / nav | `#b4b4b4` Silver Mist |
| Tertiary / captions / metadata | `#898989` Smoke |
| **Accent (CTA fill, 1 headline keyword, active nav, focus border, brand icon)** | **`#f57d05` SMARK Orange** |
| Accent — hover/pressed border on CTA | `#c25e02` (darker orange) |
| Accent — inline link / textual reference | `#ff9a3c` (lighter orange) |

### Type
- **Circular** (substitute **Inter** or **Manrope**) for *everything* — nav, body, buttons,
  headings, display. Weights **400 and 500 only — never 600/700.** Headlines are 400 (anti-bold);
  500 is the loudest voice, reserved for emphasis and button labels.
- Uniform letter-spacing **-0.007em** across all sizes (the signature tightness).
- Scale: caption 12 · body-sm 14 · body 16 · subheading 18 · heading-sm 24 · heading 36 · **display 72**.
- **Source Code Pro / JetBrains Mono** only for code-style fragments (e.g. a barcode value, a
  part SKU chip, a terminal-ish "how it works" snippet) — never body copy.

### Shape & elevation
- Radius vocabulary is strict: **buttons/tags = 9999px (pill)**, **cards = 16px**, **inputs = 8px**.
  Use nothing else.
- **No box-shadows. No gradients.** Elevation = a 1px `#2e2e2e` border on the `#121212` canvas.
- Base spacing unit 8px; section gaps 64–96px; card padding 24px; page max-width 1200px, centered.
- Input focus = the **orange border itself** (1px, no glow ring).

### Imagery / illustration
- Line-art & wireframe only: thin-stroke (1.5px) geometric shapes, grids, network nodes, shelf/box
  schematics in `#4d4d4d` stroke on `#0d0d0d`, with occasional small **orange** dot accents.
- No photography, no lifestyle imagery. Icons are thin outlined, monochrome (`#fafafa`/`#b4b4b4`),
  orange reserved for active/brand contexts. The whole thing should feel like a **developer-tool
  schematic**, not a marketing site.

---

## 3. Brand assets (in `assets/` — use these, don't invent a logo)

| File | What it is | Where to use |
|------|-----------|--------------|
| `assets/smark-logo-on-dark.svg` | Full SMARK logo, **white + orange**, made for dark backgrounds | Nav bar (left), cover, footer — the primary logo everywhere on the dark canvas |
| `assets/smark-logo-on-dark-alt.svg` | Alternate white + orange lockup | Fallback if the primary crops awkwardly |
| `assets/smark-logo-on-light.svg` | **Dark** version of the logo | Only inside the white **PDF cart** mockup (section 7), which is on a light document surface |
| `assets/smark-mark.svg` | Compact mark (orange circle + swoosh; has a dark element — recolor that element to `#fafafa` on the dark canvas) | Favicon-style mark, app-icon corner in mockups |
| `assets/smark-app-icon.png` | App icon (512px) | The PWA "app icon" shown on the phone-frame mockups |

Product name shown in the UI: **"SmarkStock"** (wordmark can sit next to the SMARK mark). If a
tagline helps: *"Every part, every box — one tap away."*

---

## 4. Sections to build (top → bottom)

Build each as a full-bleed section on the `#121212` canvas, 64–96px vertical gaps, 1200px centered
content, no visible dividers — just breathing room. Consistent nav/footer treatment throughout.

1. **Top nav (sticky)** — ~64px, transparent → `#121212` on scroll, 1px `#2e2e2e` bottom border.
   Left: SMARK logo (`smark-logo-on-dark.svg`). Center: ghost nav links in `#b4b4b4` (Circular 400,
   14px) — Overview · Inventory · Ordering · How it works. Right: a ghost "Sign in" pill and an
   **orange** "Get started" pill (static).

2. **Hero** — centered. Display headline 72px Circular 400 `#fafafa`, two lines, the **second line
   in orange `#f57d05`** (e.g. "Every part accounted for. / Ordered in one tap."). 16px subtitle in
   `#b4b4b4`. Two side-by-side pills: orange primary + ghost secondary. Optional small announcement
   pill above it (`#242424` bg, `#2e2e2e` border) like "Built for Smark Automation".

3. **The problem** — 3 pain cards (feature-card style: `#121212` bg, 1px `#2e2e2e` border, 16px
   radius, 24px padding). 200+ small parts across many boxes; tracked by memory & paper; slow,
   error-prone reordering with no single source of truth. Thin-line icon per card in orange.

4. **The solution — three fronts** — a 3-column row of cards: **Live Inventory · Smart Ordering ·
   AI brain on your own Claude.** Each with a one-line promise and a small line-art glyph.

5. **Front 1 — Live Inventory** *(mockup)* — a product-showcase card containing a dark dashboard
   UI: left rail of **shelves → boxes**, a main grid/table of parts with **quantity chips** (pill
   tags), **low-stock rows flagged in orange**, a search field (8px radius, `#393939` border), and
   a prominent **scan input** pinned at the top. Show it in a **desktop browser frame** and a
   **~360px phone frame** side by side. Part SKUs/barcodes rendered in the mono font.

6. **Barcode scanning** *(mockup + caption)* — a compact panel showing scan-to-add / scan-to-remove
   (a scanned code lands in the input, quantity ticks up). Caption in `#b4b4b4`: works with a
   plug-in **USB/Bluetooth scanner — no app, no drivers** (it just types like a keyboard), OR the
   **phone camera**. One mono "SKU: 0470-2213 ✓ +1" style line for flavor.

7. **Front 2 — Smart Ordering** *(mockup)* — the ordering screen: a technician has pasted a parts
   list; the result splits into two columns. **"In stock"** — each part with a box/shelf tag
   (`Shelf B · Box 12`). **"To order"** — each part with 2–3 supplier options showing price and two
   badge types: a filled **orange "Preferred"** badge and an outline **"Cheaper · trusted"** badge.
   Keep it dark, hairline-bordered, pill tags.

8. **The PDF cart** *(mockup — light surface)* — this ONE mockup sits on a **white/near-white
   document** (it's a printable PDF), using `smark-logo-on-light.svg` in its header. Two clean
   tables: **"You already have"** (Part · Location) and **"To buy"** (Part · Supplier · Price ·
   Link). Make it look like a real generated document, framed as a page floating on the dark canvas.

9. **Front 3 — How the AI works** *(friendly diagram, not technical)* — a simple flow:
   **Your App ⇄ a secure toolbox (MCP) ⇄ Claude on your own subscription (works from Claude web,
   desktop, or Claude Code) ⇄ live web search.** Three plain-English promises beside it, as small
   bordered cards: *"Runs on your Claude — no extra AI bills" · "Searches your preferred sites
   first" · "Only suggests an outside shop if it's trusted and genuinely cheaper."* Use line-art
   nodes with small orange accent dots.

10. **It gets smarter every week** *(mockup)* — the feedback loop. Show a small "Saved rules" list
    (pill/row items) capturing corrections like *"We already stock this in Box 3"* and *"Don't
    suggest siteX."* One line: you correct it once → it remembers → the next order is better.

11. **Runs entirely on your accounts** — a reassurance band: three logos/labels (Vercel · Supabase ·
    Claude) with a line each — *you own the accounts, you hold the keys, nothing can be switched off
    from outside, zero dependency on the developer.*

12. **Rollout** — a simple 3-phase horizontal timeline: **Phase 1** Inventory + scanning · **Phase 2**
    Ordering + PDF · **Phase 3** AI brain + learning loop. No dates, no pricing.

13. **Closing CTA** — a clean final band: short confident line ("Ready when you are.") and a single
    orange "Get started" pill (static). **No pricing.**

14. **Footer** — single dark band, SMARK logo, muted `#898989` links, 1px top border.

---

## 5. Component cheat-sheet (so nothing drifts)

- **Primary pill button:** orange `#f57d05` fill, `#fafafa` text, 1px orange border (→ `#c25e02` on
  hover), 8px×16px padding, 9999px radius, Circular 500 / 14px. The *only* filled chromatic surface.
- **Ghost pill button:** transparent, 1px `#393939` border, `#fafafa` text, 9999px radius; hover →
  border `#4d4d4d`, bg `rgba(255,255,255,0.04)`.
- **Card:** `#121212` bg, 1px `#2e2e2e` border, 16px radius, 24px padding. Heading Circular 500/18px
  `#fafafa`; body Circular 400/14px `#b4b4b4`; optional lower line-art illustration area on `#0d0d0d`.
- **Tag / quantity chip:** pill (9999px), `#242424` bg, 1px `#2e2e2e` border, 12px text. Low-stock
  chip uses orange text/border.
- **Input:** `#121212` bg, 1px `#393939` border, 8px radius, 8px×12px padding; placeholder `#898989`;
  focus → 1px orange border, no glow.
- **Announcement pill:** `#242424` bg, 1px `#2e2e2e` border, 9999px, 12px `#b4b4b4`.

## 6. Do / Don't (from the design system)

**Do:** ration the orange to ~one element per region · pills for buttons, 16px for cards, 8px for
inputs · Circular 400 for headlines / 500 for emphasis · separate surfaces with 1px `#2e2e2e`
borders · keep the canvas a single `#121212`.

**Don't:** introduce any color beyond the SMARK orange + the grayscale ramp · use font weight 600/700
· add box-shadows or gradients · use radii outside {9999, 16, 8} · put orange on large background
areas (it's punctuation, not a fill) · **include any pricing.**

---

## PROMPT — paste this into Claude Design (with the design files + `assets/` attached)

> Design a single, long, vertically-scrolling **client proposal page** for **SmarkStock**, an
> inventory + AI-ordering system for **Smark Automation** (a small Indian electronics/automation-
> parts manufacturer). Presentation-style: stacked full-width "slides" with **static,
> non-clickable UI mockups** inside clean desktop-browser and ~360px phone frames. Audience: a
> non-technical Indian business owner — plain, confident language.
>
> **Use the attached design system exactly** (`DESIGN.md`, `tokens.json`, `theme.css`,
> `variables.css`): a Supabase/Vercel-style **midnight, code-editor aesthetic** — single `#121212`
> canvas, monochrome surfaces defined by **1px `#2e2e2e` hairline borders (NO shadows, NO
> gradients)**, tight geometric **Circular** type (substitute Inter/Manrope; weights **400 and 500
> only, never bold**; uniform -0.007em tracking; 72px display headlines in weight 400), and a
> **single rationed accent color**. **Replace the reference's phosphor green with SMARK's brand
> orange `#f57d05` everywhere** (primary pill buttons, one highlighted keyword per headline, active
> nav, small icon accents, input focus borders) — hover/pressed orange `#c25e02`, inline-link
> orange `#ff9a3c`. Keep the rest of the palette identical: text `#fafafa`/`#b4b4b4`/`#898989`,
> borders `#2e2e2e`/`#393939`, icon stroke `#4d4d4d`, elevated surface `#242424`. Radius vocabulary
> is strict: **pills 9999px for buttons/tags, 16px for cards, 8px for inputs — nothing else.**
> Illustrations are thin-stroke line-art/wireframe in `#4d4d4d` on `#0d0d0d` with tiny orange
> accent dots — no photography.
>
> **Use the attached logos** — `assets/smark-logo-on-dark.svg` in the nav, cover, and footer;
> `assets/smark-logo-on-light.svg` only inside the white PDF mockup; `assets/smark-mark.svg` /
> `assets/smark-app-icon.png` for favicon/app-icon touches. Don't invent a logo.
>
> Build these sections top to bottom: **(1)** sticky top nav (SMARK logo left, ghost nav links
> center, ghost "Sign in" + orange "Get started" pills right); **(2)** centered hero — 72px
> two-line display headline with the second line in orange, 16px `#b4b4b4` subtitle, orange primary
> + ghost secondary pills; **(3)** the problem — 3 pain cards (200+ small parts across boxes/shelves,
> tracked on paper, slow error-prone reordering); **(4)** the solution — 3 cards: Live Inventory ·
> Smart Ordering · AI brain on your own Claude; **(5)** Live Inventory mockup — dark dashboard with
> a shelves→boxes rail, a parts table with quantity chips, low-stock rows flagged in orange, a
> search field, and a prominent scan input, shown in a desktop frame + a 360px phone frame (SKUs in
> mono font); **(6)** barcode scanning — a scan-to-add/remove panel with a caption that it works
> with a plug-in USB/Bluetooth scanner (no app, no drivers — it types like a keyboard) or the phone
> camera; **(7)** Smart Ordering mockup — a pasted parts list split into "In stock" (each part with
> a `Shelf B · Box 12` tag) and "To order" (each part with 2–3 supplier options, price, an orange
> "Preferred" badge and an outline "Cheaper · trusted" badge); **(8)** the PDF cart — a single
> mockup on a WHITE document surface (use the dark logo) with two tables: "You already have"
> (Part · Location) and "To buy" (Part · Supplier · Price · Link), framed as a page floating on the
> dark canvas; **(9)** How the AI works — a friendly non-technical diagram: Your App ⇄ a secure
> toolbox (MCP) ⇄ Claude on your own subscription (works from Claude web, desktop, or Claude Code)
> ⇄ live web search, with three promise cards: "Runs on your Claude — no extra AI bills",
> "Searches your preferred sites first", "Only suggests an outside shop if it's trusted and
> genuinely cheaper"; **(10)** It gets smarter — a "Saved rules" list showing corrections the agent
> remembers ("We already stock this in Box 3", "Don't suggest siteX"); **(11)** Runs entirely on
> your accounts — a reassurance band (Vercel · Supabase · Claude) stressing the client owns
> everything with zero dependency on the developer; **(12)** Rollout — a 3-phase timeline (Inventory
> + scanning · Ordering + PDF · AI brain + learning loop), no dates; **(13)** a closing CTA band
> with one orange "Get started" pill; **(14)** a minimal dark footer.
>
> **Do NOT include any pricing, cost, ₹ figures, or an "investment" section anywhere.** Keep it
> cohesive, premium, and trustworthy — a real product pitch, not a wireframe.
