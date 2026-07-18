import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ChangeRequestForm } from "@/components/portal/change-request-form";
import { CommentForm } from "@/components/portal/comment-form";
import { DocumentsList } from "@/components/portal/documents-list";
import { PhaseTimeline } from "@/components/portal/phase-timeline";
import { PmDashboard } from "@/components/portal/pm-dashboard";
import { PortalHeader } from "@/components/portal/portal-header";
import { UpdatesFeed } from "@/components/portal/updates-feed";
import { YourRequests } from "@/components/portal/your-requests";
import { lastPhaseEndDate } from "@/lib/portal/phase-math";
import { getPortalPm, getPortalProject, getPortalRequests, getPortalShared } from "@/lib/portal/queries";

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
  const [project, shared, pm, requests] = await Promise.all([
    getPortalProject(token),
    getPortalShared(token),
    getPortalPm(token),
    getPortalRequests(token),
  ]);

  // Unknown token, regenerated token, and an archived project's token all
  // resolve to the exact same `null` here — no distinction leaked (FEATURES §11).
  if (!project) notFound();

  const estDelivery = lastPhaseEndDate(project.phases) ?? project.est_delivery_date;
  const scheduleRows = project.phases.filter((p) => p.row_kind !== "footnote");

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 pt-6 pb-12 sm:px-6">
      <PortalHeader project={project} estDelivery={estDelivery} />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        {/* Main column — the work */}
        <div className="flex flex-col gap-6">
          {pm && (
            <Card padding="none">
              <CardHeader title="Tasks" />
              <CardBody>
                <PmDashboard token={token} progress={pm.progress} tasks={pm.tasks} />
              </CardBody>
            </Card>
          )}

          {scheduleRows.length > 0 && (
            <Card padding="none">
              <CardHeader title="Schedule" />
              <CardBody>
                <PhaseTimeline phases={project.phases} />
              </CardBody>
            </Card>
          )}

          <Card padding="lg" className="border-smark-orange/25 bg-surface-accent">
            <h2 className="mb-1 text-[17px] font-medium text-smark-orange">Request a change</h2>
            <p className="mb-4 text-body-sm text-silver-mist">Need something added or adjusted? Let Smark know.</p>
            <ChangeRequestForm token={token} projectId={project.project_id} />
          </Card>
        </div>

        {/* Sidebar — reference + contact */}
        <div className="flex flex-col gap-6">
          <Card padding="none">
            <CardHeader title="Your requests" />
            <CardBody>
              <YourRequests requests={requests.requests} />
            </CardBody>
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

          <Card padding="lg" className="border-smark-orange/25 bg-surface-accent">
            <h2 className="mb-1 text-[17px] font-medium text-smark-orange">Have a question?</h2>
            <p className="mb-4 text-body-sm text-silver-mist">Send a message and Smark will get back to you.</p>
            <CommentForm token={token} />
          </Card>
        </div>
      </div>

      <footer className="pt-2 pb-4 text-center text-caption text-faint">Powered by SmarkStock</footer>
    </main>
  );
}
