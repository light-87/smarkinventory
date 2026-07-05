"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getEmployeeDocumentDownloadUrlAction } from "@/lib/employees/actions";

/** Fetches a fresh signed URL on click (never cached client-side) and opens it in a new tab. */
export function DownloadDocumentButton({ documentId }: { documentId: string }) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const result = await getEmployeeDocumentDownloadUrlAction(documentId);
      if (result.ok) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Button size="sm" variant="outline" loading={isPending} onClick={download}>
      Download
    </Button>
  );
}
