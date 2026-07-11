import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { effectiveCanSee } from "@/lib/rbac/access";
import { EmptyState } from "@/components/ui/empty-state";
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
  if (!sessionUser || !effectiveCanSee(sessionUser.role, "scan", sessionUser.grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Your account doesn't have access to Scan. Ask an owner to grant the Inventory module." />
      </div>
    );
  }
  const writable = canWrite(sessionUser.role, "scan");

  return <ScanScreen canWrite={writable} />;
}
