import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canSee, type Area } from "@/lib/auth/roles";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shared body for the "not built yet" routes auth-shell stands up so nav
 * never 404s for a role that CAN see the area (docs/OWNERSHIP.md gives each
 * of these routes to a specific package — this is a placeholder, not a
 * claim on that package's surface). Same role check as the nav itself
 * (`canSee`) — a role the matrix hides from also 404s the direct URL, since
 * hiding the link isn't the enforcement (RLS is); this mirrors that for the
 * page shell too.
 */
export async function PlaceholderPage({ area, title, description }: { area: Area; title: string; description: string }) {
  const user = await getSessionUser();
  if (!user || !canSee(user.role, area)) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <EmptyState title={title} description={description} />
    </div>
  );
}
