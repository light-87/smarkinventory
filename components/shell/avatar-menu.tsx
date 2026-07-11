"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { canSee, type Role } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  employee: "Employee",
  accountant: "Accountant",
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** Avatar menu (prototype parity): name + role chip, Settings, Logout. */
export function AvatarMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const displayName = user.displayName ?? user.username;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function logout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="flex size-9 items-center justify-center rounded-full border border-charcoal bg-surface-raised font-mono text-[14px] font-medium text-snow hover:border-slate"
      >
        {initialsFor(displayName)}
      </button>

      {open && (
        <>
          <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-[59]" />
          <div className="absolute right-0 top-11 z-[60] w-[190px] rounded-xl border border-charcoal bg-surface-raised p-1.5">
            <div className="border-b border-border-divider px-3 py-2.5">
              <div className="truncate text-[14px] text-snow">{displayName}</div>
              <div className="mt-1 inline-flex rounded-full border border-charcoal px-2 py-[1px] text-[12px] text-smoke">
                {ROLE_LABEL[user.role]}
              </div>
            </div>
            {canSee(user.role, "settings") && (
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-[14px] text-silver-mist hover:bg-ash hover:text-snow"
              >
                Settings
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-[14px] text-silver-mist hover:bg-ash hover:text-snow disabled:opacity-50"
            >
              {loggingOut ? "Logging out…" : "Logout"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
