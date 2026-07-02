# Order Review (+ Mark ordered + feedback)

**Route:** `#/order/review` · **Spec:** FEATURES.md §5.7, §10 (feedback entry) · **Prototype:**
`isOrderReview`.

## 1. Purpose (baseline)

Human decision layer over the agent results: per line, confirm/override the recommended option, set
qty, mark ordered; leave corrections that become AI-Memory rules.

## 2. Current behaviour (as prototyped)

- **Per-line cards:** header ref + value + 💬 feedback toggle; option table (radio per row — Site ·
  Price · Stock · MPN · Pkg, recommended pre-selected + pill); footer: **confidence /100** (colored,
  <50 → "⚠ verify manually" warning), "AI · why" narrative, "View recommended listing ↗",
  **↺ Re-run this item**; qty input + **Mark ordered** → "Ordered ✓" (adds to On-order, opens the
  order link per spec — human buys, we never place orders).
- **Feedback (per item):** inline input ("wrong package · prefer LCSC · we already stock this") →
  Send → suggested rule in AI Memory (scope Part).
- **Remark on the whole order:** textarea → **Save remark to AI Memory** (scope Order) ·
  **↺ Re-run whole order**.
- **Footer bar:** Cart total ₹ + ordered count + **Save as PDF cart**.

## 3. Data touched

| Read | Write |
|---|---|
| `smark_agent_results` (lanes), confidence/why | `smark_order_lines` (chosen result, qty, status→ordered), `smark_orders`, `smark_agent_feedback` (item + order scope), part history (ordered event) |

## 4. Talks to (edges)

- ← **Agent run** results (A2-3); → **On-order** lines on Mark ordered (A2-5).
- Feedback + remark → **AI Memory** suggested rules (A2-8) — never auto-active (invariant).
- Re-run item / whole order → back into **Agent run** (fresh results for that scope).
- Prices are decision-support with "as of" timestamps (risk §17.3); re-check on Mark ordered per spec.

## 5. Round-2 changes

### R2-03 (ripple) — review scoped to a named BOM 🟢
Header + PDF cart carry **project · BOM name**. "Re-run whole order" re-runs THAT BOM only.

### R2-08 — Review persisted per run; action becomes "Add to cart" 🟢

Supersedes baseline §2's ordering actions (and the R2-03 line about mark-ordered grouping):

- **"Mark ordered" REMOVED from this tab.** Ordering (qty confirm, price, PO) happens only in the
  **Cart** tab (R2-09/12). Qty input here becomes a *needed-qty* prefill for the cart line.
- **Per-line action = "Add to cart"** — takes the selected option (radio) + needed qty → creates/
  updates a `smark_cart_items` row (source `review_add`, ref project·BOM·line·chosen result).
  Already-in-cart lines show "In cart ✓ ×400" with a jump link.
- **Review is a stored artifact:** every run's review state — option selections, per-line
  feedback, confidence, cart-adds — persists with the run (`smark_agent_results.selected` +
  timestamps). Revisiting a sourced BOM opens its review exactly as left, read-only options intact,
  cart-adds reflected. (The user — "client" in Vaibhav's words = the owner — can visit it later.)
- Footer bar: "Cart total" becomes **"Added to cart: N items"** + link to Cart; "Save as PDF cart"
  stays (snapshot of the review).

## 6. Open questions on this tab

*(none — cart-side questions live in `tab-on-order.md`)*
