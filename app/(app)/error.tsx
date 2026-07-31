"use client";

/**
 * app/(app)/error.tsx — error boundary for every authenticated screen.
 *
 * Until this existed, ANY error thrown while rendering a page or running a
 * Server Action escaped to Next's built-in crash page: a blank white
 * "This page couldn't load", no nav, no shell, nothing to do but reload.
 * A cleared "Hours" box was enough to trigger it. Now the shell (rail,
 * header, bottom bar) stays put and only the content area shows this card,
 * with "Try again" re-rendering the route in place.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pt-10 pb-24 sm:px-6">
      <Card tone="warn" className="flex flex-col gap-3">
        <SectionLabel>Something went wrong</SectionLabel>
        <p className="text-[15px] text-snow">
          This screen ran into a problem and couldn&apos;t finish loading. Your work is safe — nothing was lost.
        </p>
        <p className="text-caption text-faint">
          Try again first. If it keeps happening, log out and back in, then tell Smark what you were doing.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
        {error.digest && <p className="text-caption text-faint">Reference: {error.digest}</p>}
      </Card>
    </div>
  );
}
