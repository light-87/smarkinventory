/**
 * lib/employees/queries.ts — read helpers for Settings → My Profile /
 * Settings → Employees. Server-only (takes the caller's already-created
 * Supabase client — Server Components/Actions pass their per-request RLS
 * client, never the service client, so RLS is still the real boundary).
 *
 * Sensitive PAN/bank fields NEVER come from `smark_app_users` — they live in
 * `smark_employee_private`, whose RLS gates every read to self-or-owner-or-
 * accountant (migration 0011). That table, not app code, is what makes a
 * random employee's direct client query for someone else's bank details
 * return zero rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { EmployeeDirectoryEntry, OwnProfile, PrivateFields } from "./types";

const PROFILE_COLUMNS = "id, username, display_name, role, active, birth_date, date_of_joining, onboarded_at";
const PRIVATE_COLUMNS = "user_id, pan_number, bank_account_name, bank_account_number, bank_ifsc, bank_name, email, phone";

export async function getOwnProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<OwnProfile | null> {
  const { data, error } = await supabase
    .from(TABLES.app_users)
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as OwnProfile;
}

/** The caller's own sensitive fields (or null if they haven't provided any yet). */
export async function getOwnPrivateFields(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PrivateFields | null> {
  const { data, error } = await supabase
    .from(TABLES.employee_private)
    .select(PRIVATE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const { pan_number, bank_account_name, bank_account_number, bank_ifsc, bank_name, email, phone } = data;
  return { pan_number, bank_account_name, bank_account_number, bank_ifsc, bank_name, email, phone };
}

/** Minimal active-employee list (id/username/display_name only) — feeds Settings → Users' module-grant toggle grid, which needs no PII. */
export async function getActiveEmployeeOptions(
  supabase: SupabaseClient<Database>,
): Promise<Pick<OwnProfile, "id" | "username" | "display_name">[]> {
  const { data, error } = await supabase
    .from(TABLES.app_users)
    .select("id, username, display_name")
    .eq("role", "employee")
    .eq("active", true)
    .order("username", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getOwnDocuments(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from(TABLES.employee_documents)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Owner/accountant directory (Settings → Employees): every ACTIVE employee's
 * profile + sensitive fields + documents.
 *
 * Belt-and-suspenders: the page calling this already gates on role (see
 * app/(app)/settings/employees/page.tsx), and `smark_employee_private`'s own
 * RLS independently restricts the PII join to self-or-owner-or-accountant
 * (migration 0011) — but this function ALSO re-checks the caller's role
 * itself via `smark_role()` before querying anything, so it stays safe even
 * if a future call site forgets the page-level gate.
 */
export async function getEmployeeDirectory(
  supabase: SupabaseClient<Database>,
  { active = true }: { active?: boolean } = {},
): Promise<EmployeeDirectoryEntry[]> {
  const { data: role, error: roleError } = await supabase.rpc("smark_role");
  if (roleError || (role !== "owner" && role !== "accountant")) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from(TABLES.app_users)
    .select(PROFILE_COLUMNS)
    .eq("role", "employee")
    .eq("active", active)
    .order("username", { ascending: true });
  if (profilesError) throw new Error(profilesError.message);

  const userIds = (profiles ?? []).map((p) => p.id);
  if (userIds.length === 0) return [];

  const [{ data: privateRows, error: privateError }, { data: documents, error: documentsError }] = await Promise.all([
    supabase.from(TABLES.employee_private).select(PRIVATE_COLUMNS).in("user_id", userIds),
    supabase.from(TABLES.employee_documents).select("*").in("user_id", userIds).order("created_at", { ascending: false }),
  ]);
  if (privateError) throw new Error(privateError.message);
  if (documentsError) throw new Error(documentsError.message);

  return (profiles ?? []).map((profile) => {
    const priv = (privateRows ?? []).find((r) => r.user_id === profile.id) ?? null;
    return {
      profile: profile as OwnProfile,
      privateFields: priv
        ? {
            pan_number: priv.pan_number,
            bank_account_name: priv.bank_account_name,
            bank_account_number: priv.bank_account_number,
            bank_ifsc: priv.bank_ifsc,
            bank_name: priv.bank_name,
            email: priv.email,
            phone: priv.phone,
          }
        : null,
      documents: (documents ?? []).filter((d) => d.user_id === profile.id),
    };
  });
}
