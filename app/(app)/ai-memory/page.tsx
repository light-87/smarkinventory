import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canSee } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getAiMemoryScreenData } from "@/lib/ai/queries";
import { AiMemoryClient } from "@/components/ai-memory/ai-memory-client";

export const metadata: Metadata = { title: "AI Memory" };

/**
 * `/ai-memory` (plan/tab-ai-memory.md) — owner-only (§2: "AI Memory approve
 * · Settings · user management" row); employee/accountant hidden. Mirrors
 * `components/shell/placeholder-page.tsx`'s guard: a role the matrix hides
 * from 404s the direct URL too (hiding the nav link isn't the enforcement —
 * RLS + this check are).
 */
export default async function AiMemoryPage() {
  const user = await getSessionUser();
  if (!user || !canSee(user.role, "ai_memory")) notFound();

  const supabase = await createClient();
  const data = await getAiMemoryScreenData(supabase);

  return <AiMemoryClient data={data} />;
}
