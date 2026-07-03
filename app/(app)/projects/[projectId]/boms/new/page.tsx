import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getEffectiveBomColumns } from "@/lib/bom/template";
import { NewBomForm } from "@/components/bom/new-bom-form";

export const metadata: Metadata = { title: "New BOM" };

interface NewBomPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function NewBomPage({ params }: NewBomPageProps) {
  const { projectId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser || !canWrite(sessionUser.role, "projects")) {
    redirect(`/projects/${projectId}/boms`);
  }

  const supabase = await createClient();
  const columns = await getEffectiveBomColumns(supabase);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[15px] text-snow">Upload or create a BOM</h2>
      <NewBomForm projectId={projectId} initialColumns={columns} />
    </div>
  );
}
