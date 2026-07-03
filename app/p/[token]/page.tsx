import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CommentForm } from "@/components/portal/comment-form";
import { DocumentsList } from "@/components/portal/documents-list";
import { PhaseTimeline } from "@/components/portal/phase-timeline";
import { PortalHeader } from "@/components/portal/portal-header";
import { ProgressPanel } from "@/components/portal/progress-panel";
import { UpdatesFeed } from "@/components/portal/updates-feed";
import { lastPhaseEndDate } from "@/lib/portal/phase-math";
import { getPortalProject, getPortalShared } from "@/lib/portal/queries";

/**
 * `/p/[token]` — the public client portal (FEATURES.md §17,
 * plan/tab-client-portal.md). Outside `app/(app)/`'s auth shell on purpose:
 * no rail/header/avatar menu, just this route's own minimal Smark-branded
 * chrome (`PortalHeader`). Every read goes through the two SECURITY DEFINER
 * RPCs in `supabase/migrations/0006_portal_fns.sql` via `lib/portal/queries`
 * — this component never queries a `smark_` table directly.
 *
 * `force-dynamic`: token-gated, always-fresh content (and the comment RPC is
 * itself rate-limited server-side) — no static generation, no ISR caching.
 */
export const dynamic = "force-dynamic";

interface PortalPageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PortalPageProps): Promise<Metadata> {
  const { token } = await params;
  const project = await getPortalProject(token);
  return {
    title: project ? `${project.name} · Smark` : "Smark Client Portal",
    // Capability-token URLs are never meant to be crawled/indexed.
    robots: { index: false, follow: false },
  };
}

export default async function PortalPage({ params }: PortalPageProps) {
  const { token } = await params;
  const [project, shared] = await Promise.all([getPortalProject(token), getPortalShared(token)]);

  // Unknown token, regenerated token, and an archived project's token all
  // resolve to the exact same `null` here — no distinction leaked (FEATURES §11).
  if (!project) notFound();

  const estDelivery = lastPhaseEndDate(project.phases) ?? project.est_delivery_date;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 pt-6 pb-12 sm:px-6">
      <PortalHeader project={project} estDelivery={estDelivery} />

      <Card padding="none">
        <CardHeader title="Timeline" />
        <CardBody>
          <PhaseTimeline phases={project.phases} />
        </CardBody>
      </Card>

      <Card padding="lg">
        <ProgressPanel phases={project.phases} />
      </Card>

      <Card padding="none">
        <CardHeader title="Updates" />
        <CardBody>
          <UpdatesFeed activities={shared.activities} />
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader title="Documents" />
        <CardBody>
          <DocumentsList documents={shared.documents} />
        </CardBody>
      </Card>

      <Card padding="lg">
        <h2 className="mb-1 text-[15px] font-medium text-snow">Have a question?</h2>
        <p className="mb-4 text-body-sm text-smoke">
          Send a message and Smark will get back to you.
        </p>
        <CommentForm token={token} />
      </Card>

      <footer className="pt-2 pb-4 text-center text-caption text-faint">
        Powered by SmarkStock
      </footer>
    </main>
  );
}
