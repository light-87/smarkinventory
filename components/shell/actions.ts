"use server";

/**
 * components/shell/actions.ts — server actions backing the header's
 * scan-or-type field (FEATURES.md §5 header spec; plan/tab-login-shell.md
 * "top-bar scan-or-type field"). Scope is deliberately the SHELL stub the
 * mission calls for: "Enter → if code matches PID/box pattern route to
 * part/box, else no-op". The full Ctrl-K palette over parts/projects/BOMs/PO
 * numbers (R2-34) is search-notifications' job (components/search/**); this
 * file only resolves an exact scanned/typed code.
 */

import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";

export type ResolveCodeResult =
  | { type: "part"; pid: string }
  | { type: "box"; boxId: string }
  | { type: "none" };

/** SmarkStock internal PIDs are always `SMK-` + digits (FEATURES.md §8). */
const PID_PATTERN = /^SMK-\d+$/i;

/**
 * Resolves a scanned/typed code to a part or a big-box, via the printed QR
 * value first (`smark_qr_labels.code_value`, covers both target types) with
 * a direct `internal_pid` fallback for a code typed by hand rather than
 * scanned. Uses the caller's own session (RLS-scoped) — never the service
 * role — so an accountant gets the same read-only resolution everyone else does.
 */
export async function resolveScanCode(rawCode: string): Promise<ResolveCodeResult> {
  const code = rawCode.trim();
  if (!code) return { type: "none" };

  const supabase = await createClient();

  const { data: label } = await supabase
    .from(TABLES.qr_labels)
    .select("target_type, target_id")
    .eq("code_value", code)
    .maybeSingle();

  if (label?.target_type === "part") {
    const { data: part } = await supabase
      .from(TABLES.parts)
      .select("internal_pid")
      .eq("id", label.target_id)
      .maybeSingle();
    if (part) return { type: "part", pid: part.internal_pid };
  }

  if (label?.target_type === "big_box") {
    return { type: "box", boxId: label.target_id };
  }

  // Typed-by-hand fallback: looks like a PID even without a label-table hit.
  if (PID_PATTERN.test(code)) {
    const { data: part } = await supabase
      .from(TABLES.parts)
      .select("internal_pid")
      .ilike("internal_pid", code)
      .maybeSingle();
    if (part) return { type: "part", pid: part.internal_pid };
  }

  return { type: "none" };
}
