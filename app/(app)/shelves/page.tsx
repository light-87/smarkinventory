import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRackShelves } from "./queries";
import { ShelfBand } from "@/components/shelves/ShelfBand";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Shelves" };

export default async function ShelvesPage() {
  const supabase = await createClient();
  const shelves = await getRackShelves(supabase);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-heading-sm font-normal text-snow">Shelves</h1>
        <p className="text-[13px] text-smoke">
          The physical rack — open a box to see its ESD plastics · run a count.
        </p>
      </div>

      {shelves.length === 0 ? (
        <EmptyState
          title="No shelves yet"
          description="Shelves and big boxes are created from Receive as stock comes in."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {shelves.map((shelf) => (
            <ShelfBand key={shelf.id} shelf={shelf} />
          ))}
        </div>
      )}
    </div>
  );
}
