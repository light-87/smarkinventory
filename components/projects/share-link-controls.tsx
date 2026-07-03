"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { regenerateShareTokenAction } from "@/lib/projects/actions";

export interface ShareLinkControlsProps {
  projectId: string;
  shareToken: string | null;
}

/** Client-portal share-link controls (R2-30/§11): copy `/p/:share_token`, regenerate = revoke (owner-only). */
export function ShareLinkControls({ projectId, shareToken }: ShareLinkControlsProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [token, setToken] = useState(shareToken);

  const link = token && typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : token ? `/p/${token}` : null;

  function copy() {
    if (!link) return;
    navigator.clipboard
      .writeText(link)
      .then(() => push({ msg: "Link copied" }))
      .catch(() => push({ msg: "Couldn't copy — copy it manually" }));
  }

  function regenerate() {
    if (token && !window.confirm("Regenerating revokes the old link — anyone using it loses access. Continue?")) {
      return;
    }
    startTransition(async () => {
      try {
        const result = await regenerateShareTokenAction(projectId);
        setToken(result.token);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't generate a link." });
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel>Client portal</SectionLabel>
      {link ? (
        <>
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} mono />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              Copy link
            </Button>
            <Button size="sm" variant="ghost" onClick={regenerate} loading={isPending}>
              Regenerate (revokes old link)
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-caption text-smoke">Not shared yet — generate a read-only link for the client.</p>
          <Button size="sm" variant="outline" onClick={regenerate} loading={isPending} className="self-start">
            Generate share link
          </Button>
        </>
      )}
    </Card>
  );
}
