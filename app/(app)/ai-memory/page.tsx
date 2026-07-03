import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "AI Memory" };

// Placeholder — ai-memory owns app/(app)/ai-memory/** (docs/OWNERSHIP.md).
export default function AiMemoryPage() {
  return (
    <PlaceholderPage
      area="ai_memory"
      title="AI Memory is on its way"
      description="Suggested rules, the versioned digest and rule-hit run logs will live here."
    />
  );
}
