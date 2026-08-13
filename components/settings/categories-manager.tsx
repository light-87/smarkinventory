"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/format";
import { renameCategoryAction, renameSubCategoryAction } from "@/lib/categories/actions";
import type { CategoryUsage } from "@/lib/categories/queries";

export interface CategoriesManagerProps {
  categories: CategoryUsage[];
  writable: boolean;
}

/**
 * Settings → Categories: rename a category or sub-category everywhere at once,
 * or drop a sub-category that shouldn't exist.
 *
 * There is no "create" button, and that is the honest shape of the data rather
 * than an omission: a category exists because a part says so. Typing a new one
 * on a part in Receive creates it, and it appears here the moment it does. A
 * button that registered a name no part used would produce a category that
 * shows up in every filter and matches nothing.
 */
export function CategoriesManager({ categories, writable }: CategoriesManagerProps) {
  const { push } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function renameCategory(from: string) {
    startTransition(async () => {
      const result = await renameCategoryAction({ from, to: draft });
      if (result.ok) {
        push({ msg: `Renamed — ${formatNumber(result.updated)} part${result.updated === 1 ? "" : "s"} updated` });
        setEditing(null);
        router.refresh();
      } else push({ msg: result.error });
    });
  }

  function editSubCategory(category: string, from: string, to: string | null) {
    startTransition(async () => {
      const result = await renameSubCategoryAction({ category, from, to });
      if (result.ok) {
        push({
          msg: to
            ? `Renamed on ${formatNumber(result.updated)} part${result.updated === 1 ? "" : "s"}`
            : `Removed from ${formatNumber(result.updated)} part${result.updated === 1 ? "" : "s"}`,
        });
        setEditing(null);
        router.refresh();
      } else push({ msg: result.error });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Card padding="md">
        <div className="text-[15px] text-snow">Categories and sub-categories</div>
        <p className="mt-1 text-caption text-smoke">
          Renaming moves every part with that name. To add a new one, type it when receiving a part — it appears
          here as soon as something uses it.
        </p>
      </Card>

      {categories.map((category) => (
        <Card key={category.name} padding="md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {editing === `cat:${category.name}` ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} uiSize="sm" className="max-w-[240px]" />
                <Button size="sm" onClick={() => renameCategory(category.name)} loading={isPending}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <span className="text-[15px] text-snow">{category.name}</span>
                  <span className="ml-2 text-caption text-smoke">
                    {formatNumber(category.partCount)} part{category.partCount === 1 ? "" : "s"}
                  </span>
                </div>
                {writable && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(`cat:${category.name}`);
                      setDraft(category.name);
                    }}
                    className="cursor-pointer text-caption text-smark-orange hover:underline"
                  >
                    Rename
                  </button>
                )}
              </>
            )}
          </div>

          {category.subCategories.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border-hairline pt-3">
              {category.subCategories.map((sub) => {
                const key = `sub:${category.name}:${sub.name}`;
                return (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-2">
                    {editing === key ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <Input
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          uiSize="sm"
                          className="max-w-[220px]"
                        />
                        <Button
                          size="sm"
                          onClick={() => editSubCategory(category.name, sub.name, draft)}
                          loading={isPending}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="text-[15px] text-silver-mist">
                          {sub.name}
                          <span className="ml-2 text-caption text-smoke">{formatNumber(sub.partCount)}</span>
                        </span>
                        {writable && (
                          <span className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(key);
                                setDraft(sub.name);
                              }}
                              className="cursor-pointer text-caption text-smark-orange hover:underline"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => editSubCategory(category.name, sub.name, null)}
                              disabled={isPending}
                              className="cursor-pointer text-caption text-smoke hover:text-snow hover:underline"
                            >
                              Remove
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
