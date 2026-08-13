# AI image-model prompt — "make this architecture diagram 100× better"

Attach one of the diagram PNGs (`smarkstock-system.png` etc.) and use **Prompt A**.
Use **Prompt B** if the model takes text only. (Assumes the model renders diagram
text flawlessly and is free to re-compose — so these prompts give it real creative
latitude while keeping the architecture faithful.)

Good picks: **Nano Banana (Gemini 2.5 Flash Image)**, **GPT-Image-1**, **Ideogram 3**,
**Recraft V3** (also exports clean vector/SVG).

> ⚠️ **HARD-LEARNED (2026-07-20): image-model text is whack-a-mole.** Every edit pass
> re-transcribes *all* text and drifts on *different* labels — fixing two breaks four
> (our "fix C" pass broke role-gated→"role=gstad", bulk-takeout→"take/adjust",
> draft-expense→"draft copies", security-definer→"security-defined", and still didn't
> fix the target). It is NOT monotonic. Workflow that actually works:
> 1. Get the *look* you love from the image model (don't re-roll for text).
> 2. Do the final label corrections **once, in a real editor** (Figma / Photoshop /
>    Excalidraw) — never another AI pass.
> 3. Keep the **VibeView board version as the source of truth** (100% correct text);
>    the AI render is the pretty skin, the board is the accurate spec.
> Also: the *bigger* the transformation (flat→isometric), the *more* text drifts —
> so restyle small if accuracy matters, go bold if it's a hero/marketing image.

---

## Prompt A — REIMAGINE (attach the PNG)

> You are a senior product designer. Reimagine the attached software-architecture
> diagram as a stunning, premium diagram — the kind that headlines a top-tier SaaS
> launch (think Vercel, Linear, Stripe, Supabase keynote slides). Keep the
> architecture **factually faithful**: every component, label, and connection must
> still be present and correctly spelled, and no relationship may change. But you
> are free to **re-compose, re-balance, and beautify** — improve the layout, spacing,
> grouping, icon language, and flow so it reads instantly and looks world-class.
>
> **Art direction — premium dark tech:**
> - Deep charcoal canvas (#0E0E10–#161616) with a whisper-faint dot grid and soft
>   vignette; a sense of depth, like frosted-glass panels floating over the grid.
> - Group the system into clearly bounded **zones** (Users · Web App · Desktop
>   sourcing engine · Data & services · Client portal), each a translucent glass
>   container with a subtle colored edge-glow and a quiet section label.
> - Nodes: rounded rectangles, hairline 1px borders, gentle inner sheen, soft long
>   shadows for layered depth. Refined **duotone line icons** in every node (browser,
>   database, cloud, desktop app, AI/agent, robot-browsing, people, envelope, bell,
>   distributor/chip). Consistent icon weight and grid.
> - **Color:** SMARK orange **#f57d05** as the hero accent — the title, the primary
>   flow arrows, and the AI/sourcing path glow orange. Zones distinguished with
>   *muted, sophisticated* secondary hues (desaturated indigo, teal, emerald, violet);
>   restrained, never neon-loud. High-contrast, accessible text.
> - **Typography:** modern geometric sans (Inter / Circular / Geist). Strong
>   hierarchy — bold zone titles, medium node titles, light captions. Impeccable
>   kerning and alignment on a clean grid.
> - **Flow:** elegant orthogonal or gently-curved connectors with tapered arrowheads
>   and small glowing junction dots; label the key edges (e.g. "/api/desktop",
>   "Playwright MCP", "realtime", "RPC read"). The main data path should feel like it
>   has motion/energy.
> - Generous whitespace, perfect optical balance, print-crisp edges, 16:9-friendly.
>   Optionally add a slim title bar and a tiny legend. Make it feel *engineered*, not
>   decorated.
>
> Deliver a single cohesive, gorgeous hero-quality architecture diagram.

*Style swaps (replace the "premium dark tech" block if you'd rather):*
- **Isometric 2.5D** — nodes as soft isometric blocks with ambient occlusion,
  floating connectors, orange glow on the active path; a cloud-architecture "hero
  render." Highest wow factor.
- **Light editorial** — warm off-white canvas, soft realistic shadows, pastel zone
  tints, SMARK-orange accents; a crisp Notion/Figma-docs elegance.
- **Blueprint** — dark navy, fine cyan grid, glowing orange callouts; technical,
  precise, engineering-drawing feel.

---

## Prompt B — FROM SCRATCH (text only)

> Design a stunning, hero-quality **dark-mode software-architecture diagram** titled
> **"SmarkStock — System Architecture,"** SMARK orange (#f57d05) as the hero accent.
> Premium Vercel/Linear/Supabase-keynote aesthetic: #0E0E10 canvas with a faint dot
> grid, translucent glass zone containers with soft edge-glow, rounded hairline
> nodes with depth shadows and refined duotone line icons, modern geometric sans
> typography with strong hierarchy, elegant glowing connectors with labeled edges.
> Compose it beautifully in clear horizontal zones with generous whitespace and
> perfect alignment. Render this exact system, every label spelled correctly:
>
> - **Users (top):** Owner, Employee, Accountant (role-gated, RLS) use the web app; a Client uses a public portal.
> - **SmarkStock Web App** (Next.js on Vercel, PWA), three groups: *Inventory & Ops*
>   (dashboard, inventory, shelves, scan, receive, bulk-takeout, QR labels);
>   *Projects & Ordering* (projects, BOMs, reconcile, ordering workspace, run review,
>   smart cart, checkout→PO, draft expense); *Team & Admin* (attendance, daily reports,
>   AI Memory, Settings, AI-orc observatory, API routes, an alias layer wrapping all AI calls).
> - **SmarkStock Desktop app** (Tauri, owner's PC) — the AI part-sourcing engine: a
>   *desktop runner* that logs into Supabase, calls `/api/desktop/run-context`,
>   REST-prefetches distributors, then spawns the owner's own **Claude Code CLI (Haiku)**
>   which drives a real **Brave** browser via Playwright MCP to browse distributor
>   sites (LCSC, Unikey) and REST APIs (Digikey, Mouser, element14); results POST back.
> - **Data & services:** Supabase (Postgres, Auth, Realtime, RLS, `smark_` tables);
>   Cloudflare R2 (all files); Claude API (server small calls: receipt extraction, MPN
>   normalization, aliased); Vercel Cron → Resend (daily client-reminder emails).
> - **Client portal** `/p/[token]`: public, read-only (phases, progress, shared docs,
>   comments via security-definer RPC).
> - A **legacy cloud worker** (Opus + Sonnet), shown faded/dashed, labeled "built but mock-only, superseded."
>
> **Flows to draw as glowing arrows:** users → web app; web app ↔ Supabase, → R2,
> → Claude API; web app ↔ desktop app (`/api/desktop/*`); desktop runner → Claude Code
> → Brave → distributor sites; client → portal → Supabase; Cron → Resend → client.

---

*Iterate:* if you love the look but want tweaks, add a line like "keep this exact
style, but enlarge the Desktop sourcing zone and make the AI path glow brighter."

---

## Prompt C — POLISH (feed the winning render, e.g. B.png)

> Keep this exact diagram — same layout, same components, same labels, same dark
> theme and SMARK-orange (#f57d05) palette. Refine only, don't redesign:
> - Add a slim **title bar** across the top: "SmarkStock — System Architecture" with a
>   one-line subtitle, and a small **legend** (bottom-right) mapping the zone colors:
>   Users · Web App · Desktop engine · Data & services · Client portal.
> - Make the **AI part-sourcing path the hero**: brighten and thicken the orange flow
>   Web App → Desktop runner → Claude Code CLI (Haiku) → Brave → distributor sites, with
>   a soft outer glow and clear arrowheads; keep other arrows quieter and thinner.
> - Wrap each zone in a subtly darker **translucent glass panel** with a faint colored
>   edge-glow and a small zone label in its corner.
> - Add a touch more padding; snap every node chip to a clean grid; equalize corner
>   radii and icon sizes.
> - Every label crisp and correctly spelled, high-contrast; add a small tasteful duotone
>   icon to any node missing one.
> - Print-crisp, 16:9. Deliver the same diagram, just more polished and premium.

## Prompt D — ISOMETRIC 2.5D (feed B.png; falls back to spec below)

> Re-render this software-architecture diagram as a breathtaking **isometric 2.5D**
> illustration — a cloud-architecture "hero render." Keep every component, label, and
> connection factually identical and correctly spelled; only change projection and finish.
>
> **Art direction:** true isometric projection (~30° axes) on a dark #0E0E10 grid floor
> with soft vignette and gentle depth-of-field. Each **zone becomes a raised isometric
> platform** (Users · SmarkStock Web App · Desktop sourcing engine · Data & services ·
> Client portal), floating at slightly varied heights with a glowing colored rim, soft
> ambient occlusion, and long soft shadows; a floating label hovers over each platform.
> **Nodes are extruded 3D slabs** with small isometric icons on top (browser, database,
> cloud, monitor, chip, terminal, robot-browser, people, envelope, bell). **Connectors
> are glowing ribbons/tubes** with directional pulses; the **AI part-sourcing path glows
> brightest SMARK-orange (#f57d05)** — Web App → Desktop runner → Claude Code (Haiku) →
> Brave → distributor sites — secondary flows in muted indigo/teal/emerald/violet.
> Subtle bloom, cinematic yet clean, immaculate alignment. 16:9, high detail, crisp.
>
> Preserve exactly: Users (Owner, Employee, Accountant → web app; Client → public
> portal); Web App groups (Inventory & Ops · Projects & Ordering · Team & Admin + alias
> layer); Desktop pipeline (runner → Supabase login → /api/desktop/run-context →
> REST-prefetch → Claude Code CLI Haiku → Brave via Playwright MCP → distributor sites
> LCSC/Unikey + REST Digikey/Mouser/element14, results POST back); Data & services
> (Supabase · Cloudflare R2 · Claude API · Vercel Cron → Resend); Client portal
> /p/[token] (security-definer RPC); faded/dashed legacy cloud worker "built but
> mock-only, superseded."
