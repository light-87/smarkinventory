import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getReviewData } from "@/lib/runs/queries";
import { ensureBomSourced } from "@/lib/runs/lifecycle";
import { ReviewView } from "@/components/review/review-view";

export const metadata: Metadata = { title: "Order review" };

// The review page auto-refreshes (components/review/review-auto-refresh.tsx) so
// live desktop syncs appear without a manual reload — it must re-run per request.
export const dynamic = "force-dynamic";

interface ReviewPageProps {
  params: Promise<{ projectId: string; runId: string }>;
}

/**
 * Order Review (plan/tab-order-review.md, R2-08 "persisted per run"). Lands
 * here from the Agent Run console's "Review results →" — reopening a sourced
 * BOM later renders this exact same stored state (selections, feedback,
 * cart-adds all live on the DB rows this reads, not client-only state).
 */
export default async function ReviewPage({ params }: ReviewPageProps) {
  const { projectId, runId } = await params;

  const supabase = await createClient();
  const service = createServiceClient();
  const [data, sessionUser] = await Promise.all([getReviewData(supabase, service, runId), getSessionUser()]);
  if (!data) notFound();
  // Cross-project-id guard mirrors the ordering workspace / run console pages.
  if (data.project.id !== projectId) notFound();

  const writable = sessionUser != null && canWrite(sessionUser.role, "projects");

  // First time this BOM's review is opened, flip draft → sourced (no-op on repeat
  // visits — lib/runs/lifecycle.ts). A desktop run with INADEQUATE coverage must NOT
  // auto-source: that would undo the sync.ts coverage guardrail and unblock the cart
  // on a half-sourced BOM. The owner uses the review's "Accept anyway" for that.
  // (coverage is null for cloud/legacy runs → unchanged behavior.)
  if (data.coverage == null || data.coverage.adequate) {
    await ensureBomSourced(supabase, data.bom.id);
  }

  return <ReviewView projectId={projectId} data={data} writable={writable} />;
}
