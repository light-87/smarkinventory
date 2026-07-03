"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import type { AppUserOption, ProjectMemberWithUser } from "@/lib/projects/queries";
import { addProjectMemberAction, removeProjectMemberAction } from "@/lib/projects/team-actions";

export interface TeamMembersCardProps {
  projectId: string;
  members: readonly ProjectMemberWithUser[];
  activeUsers: readonly AppUserOption[];
  /** Assign/remove is owner-only (R2-18/R2-04). */
  isOwner: boolean;
}

/** Team & hours — member roster (R2-04): owner assigns/removes; visible read-only to everyone else. */
export function TeamMembersCard({ projectId, members, activeUsers, isOwner }: TeamMembersCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [pickedUserId, setPickedUserId] = useState("");

  const memberUserIds = new Set(members.map((m) => m.membership.user_id));
  const assignable = activeUsers.filter((u) => !memberUserIds.has(u.id));

  function addMember() {
    if (!pickedUserId) return;
    startTransition(async () => {
      try {
        await addProjectMemberAction(projectId, pickedUserId);
        setPickedUserId("");
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't add that member." });
      }
    });
  }

  function removeMember(membershipId: string) {
    startTransition(async () => {
      try {
        await removeProjectMemberAction(projectId, membershipId);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't remove that member." });
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel>Team</SectionLabel>
      {members.length === 0 ? (
        <p className="text-caption text-smoke">No one assigned yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <Chip key={m.membership.id} tone="neutral" className="gap-2">
              {m.user?.display_name ?? m.user?.username ?? "Unknown"}
              <span className="text-faint">· {m.user?.role}</span>
              {isOwner && (
                <button
                  type="button"
                  aria-label="Remove member"
                  onClick={() => removeMember(m.membership.id)}
                  disabled={isPending}
                  className="cursor-pointer text-smoke hover:text-smark-orange disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </Chip>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="flex gap-2">
          <select
            value={pickedUserId}
            onChange={(e) => setPickedUserId(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-charcoal bg-surface-well px-3 text-[13px] text-snow outline-none focus:border-smark-orange"
          >
            <option value="">Add a member…</option>
            {assignable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ?? u.username} · {u.role}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={addMember} loading={isPending} disabled={!pickedUserId}>
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}
