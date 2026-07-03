import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getBoxDetail } from "../queries";
import { BoxDetailCard } from "@/components/shelves/BoxDetailCard";
import { LiveContentsTable } from "@/components/shelves/LiveContentsTable";
import { AuditLauncher } from "@/components/shelves/AuditLauncher";

export const metadata: Metadata = { title: "Box detail" };

interface BoxDetailPageProps {
  params: Promise<{ boxId: string }>;
}

export default async function BoxDetailPage({ params }: BoxDetailPageProps) {
  const { boxId } = await params;

  const supabase = await createClient();
  const [detail, sessionUser] = await Promise.all([getBoxDetail(supabase, boxId), getSessionUser()]);
  if (!detail) notFound();

  // No session (or a role the matrix hides Shelves from) → read-only: the
  // print/audit actions never render. RLS enforces the same rule server-side
  // regardless (FEATURES.md §2: "enforced twice — UI and RLS").
  const writable = sessionUser != null && canWrite(sessionUser.role, "shelves");

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-[18px] flex items-center gap-2 text-[13px] text-smoke">
        <Link href="/shelves" className="transition-colors hover:text-snow">
          ← All shelves
        </Link>
        <span className="text-faint">/</span>
        <span className="font-mono text-snow">Box {detail.box.code}</span>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <BoxDetailCard
          boxId={detail.box.id}
          boxCode={detail.box.code}
          shelfCode={detail.shelf.code}
          qrDataUrl={detail.qrDataUrl}
          labelText={detail.labelText}
          lastAuditedAt={detail.lastAuditedAt}
          canPrint={writable}
        />
        <div className="min-w-[300px] flex-1 space-y-4">
          <LiveContentsTable items={detail.items} />
          {writable && <AuditLauncher boxId={detail.box.id} boxCode={detail.box.code} items={detail.items} />}
        </div>
      </div>
    </div>
  );
}
