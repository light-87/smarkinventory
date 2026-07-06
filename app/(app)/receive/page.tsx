import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { effectiveCanSee } from "@/lib/rbac/access";
import { getModuleGrantsIfEmployee } from "@/lib/rbac/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { ReceiveScreen, type ReceiveCard } from "@/components/receive/receive-screen";
import {
  getActiveCustomFieldTemplates,
  getArrivedOrderLines,
  getBoxOptions,
  getOnboardingQueue,
  getQueuedLabelCount,
} from "@/lib/receive/queries";

export const metadata: Metadata = { title: "Receive" };

const VALID_CARDS: readonly ReceiveCard[] = ["new-part", "top-up", "put-away"];

function parseCard(value: string | string[] | undefined): ReceiveCard | undefined {
  const card = Array.isArray(value) ? value[0] : value;
  return VALID_CARDS.find((c) => c === card);
}

export default async function ReceivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: role } = user ? await supabase.rpc("smark_role") : { data: null };
  const grantedModules = role && user ? await getModuleGrantsIfEmployee(supabase, user.id, role) : [];

  if (!role || !effectiveCanSee(role, "receive", grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Sign in with an owner or employee account to use Receive." />
      </div>
    );
  }

  const boxes = await getBoxOptions(supabase);
  const [customFieldTemplates, arrivedGroups, onboardingRows, queuedLabelCount] = await Promise.all([
    getActiveCustomFieldTemplates(supabase),
    getArrivedOrderLines(supabase),
    getOnboardingQueue(supabase, boxes),
    getQueuedLabelCount(supabase),
  ]);

  const presetBoxId = Array.isArray(params.boxId) ? params.boxId[0] : params.boxId;

  return (
    <ReceiveScreen
      boxes={boxes}
      customFieldTemplates={customFieldTemplates}
      arrivedGroups={arrivedGroups}
      onboardingRows={onboardingRows}
      queuedLabelCount={queuedLabelCount}
      defaultCard={parseCard(params.card)}
      presetBoxId={presetBoxId ?? null}
      canWrite={canWrite(role, "receive")}
    />
  );
}
