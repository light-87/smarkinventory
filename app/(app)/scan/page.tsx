import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { ScanScreen } from "@/components/scan/scan-screen";

export const metadata: Metadata = { title: "Scan" };

/**
 * Server wrapper: resolves the session role so `ScanScreen` can hide/disable
 * Take out & Add for a read-only role (FEATURES.md §2 accountant=read-only
 * on Scan) — the UI half of the "enforced twice" matrix; the write path
 * (`lib/scan/actions.ts`) enforces the same rule server-side regardless.
 */
export default async function ScanPage() {
  const sessionUser = await getSessionUser();
  const writable = sessionUser != null && canWrite(sessionUser.role, "scan");

  return <ScanScreen canWrite={writable} />;
}
