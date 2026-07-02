# Client Portal (NEW surface — R2-38 + R2-30 share link)

**Route:** `/p/:share_token` (public, outside the app shell) · **Introduced by:** R2-38 (approved
I-10) consolidating Q-04's tokenized link and R2-30's phase timeline · **Audience:** Smark's END
CLIENTS (Acme etc.) — non-authenticated v1.

## 1. Purpose

"A good UI for the client — they can see the reports, progress and everything there." Each project
gets a polished, read-only page the owner shares by link; the client follows progress without
calling, and their feedback flows back into the project feed.

## 2. Planned behaviour

- **Access:** tokenized URL per project (`smark_projects.share_token`, regenerable to revoke; no
  login v1). `client` role login = future upgrade seam — schema tolerates it, nothing built now.
- **Page content (read-only):**
  - Header: project name, Smark branding, status chip, estimated delivery.
  - **Phase timeline (R2-30):** the estimate-sheet table rendered beautifully — phase name,
    start/end, duration, tasks/notes, parallel/buffer rows; current phase highlighted; done phases
    checked; scope-exclusion notes (their "Note1: enclosure not included" pattern) shown as
    footnotes.
  - **Progress:** completion % (semantics per Q-07) + on-track indicator.
  - **Updates:** owner-curated feed — activity entries explicitly marked "share to portal"
    (default OFF; nothing leaks by accident). Documents likewise: only explicitly shared files.
  - **Client input:** comment box → lands in the project activity feed as type `change`, tagged
    "from client portal" (owner gets a notification, R2-36).
- **Never shown:** costs/prices, inventory, team hours, internal notes, other projects.
- Mobile-first (their clients will open it on WhatsApp links); Smark orange theme; no app chrome.

## 3. Data touched

| Read | Write |
|---|---|
| project (name/status/phases/progress), shared activities + documents | `smark_project_activities` (type `change`, source portal) |

## 4. Talks to (edges)

- **Projects hub** — owner manages phases (R2-30), toggles "share to portal" per update/document,
  copies/regenerates the link.
- **Notifications (R2-36)** — portal comment → owner notified.
- **Security:** token is capability-based — treat as public once sent; regenerate to revoke; rate-
  limited comment endpoint; no PII beyond project content the owner chose to share.

## 5. Round-2 changes

- **R2-38** — this surface 🟢 · **R2-30** — timeline rendering 🟢

## 6. Open questions on this tab

- ~~Q-07~~ closed: progress % = duration-weighted done phases; on-track chip same as internal.
- Portal comment moderation (auto-publish to feed vs owner approves) — default: straight to feed,
  flagged chip; revisit if abused.
