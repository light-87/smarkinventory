import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Observatory } from "@/components/ai-orc/observatory";

export const metadata: Metadata = { title: "AI orchestration" };

/**
 * /ai_orc — the owner's AI-orchestration observatory (manual-testing
 * request): every run's full lifecycle (exact Opus/Sonnet prompts → per-line
 * agent lanes → results) plus live worker machine telemetry (RAM/CPU —
 * migration 0008), so a 2 GB worker box is observable while a run fans out.
 * Owner-only; not in the nav — reached by URL, like an ops console.
 */
export default async function AiOrcPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") notFound();

  return <Observatory />;
}
