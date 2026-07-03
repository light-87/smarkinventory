import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getBomDetail } from "@/lib/bom/queries";
import { ReconcileView } from "@/components/bom/reconcile-view";

export const metadata: Metadata = { title: "BOM" };

interface BomDetailPageProps {
  params: Promise<{ projectId: string; bomId: string }>;
}

export default async function BomDetailPage({ params }: BomDetailPageProps) {
  const { projectId, bomId } = await params;

  const supabase = await createClient();
  const [detail, sessionUser] = await Promise.all([getBomDetail(supabase, bomId), getSessionUser()]);
  if (!detail || detail.bom.project_id !== projectId) notFound();

  const writable = sessionUser != null && canWrite(sessionUser.role, "projects");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[13px] text-smoke">
        <Link href={`/projects/${projectId}/boms`} className="transition-colors hover:text-snow">
          ← All BOMs
        </Link>
        <span className="text-faint">/</span>
        <span className="text-snow">{detail.bom.name}</span>
      </div>

      <ReconcileView bom={detail.bom} lines={detail.lines} writable={writable} />
    </div>
  );
}
