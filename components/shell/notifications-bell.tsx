"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TABLES } from "@/types/db";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BellIcon } from "./icons";

interface NotificationLite {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Header notifications bell — SHELL per the mission brief: unread-count
 * query, dropdown list, mark-read. The fan-out writer side (`notifyArrival()`
 * etc.) and any realtime channel belong to search-notifications
 * (lib/notifications/**); this reads `smark_notifications` directly under
 * the caller's own RLS (self rows, or every row for the owner — same policy
 * as everywhere else) and polls rather than subscribing.
 */
export function NotificationsBell({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationLite[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from(TABLES.notifications)
        .select("id, title, body, link, read_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) setItems(data ?? []);
    }

    load();
    const interval = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markRead(notification: NotificationLite) {
    setItems((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
    );
    const supabase = createClient();
    await supabase.from(TABLES.notifications).update({ read_at: new Date().toISOString() }).eq("id", notification.id);
    setOpen(false);
    if (notification.link) router.push(notification.link);
  }

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    const supabase = createClient();
    await supabase.from(TABLES.notifications).update({ read_at: now }).in("id", unreadIds);
  }

  return (
    <div className="relative flex-none">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-9 items-center justify-center rounded-full border border-charcoal bg-surface-raised text-smoke hover:border-slate"
      >
        <span aria-hidden className="size-[18px] [&_svg]:size-full">
          <BellIcon />
        </span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-smark-orange px-1 font-mono text-[10px] font-medium text-obsidian">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-[59]" />
          <div className="absolute right-0 top-11 z-[60] max-h-[70vh] w-[320px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl border border-charcoal bg-surface-raised p-2">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] tracking-[0.06em] text-smoke uppercase">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="cursor-pointer text-[11px] text-smark-orange hover:text-smark-orange-hover"
                >
                  Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="px-2 py-6 text-center text-[13px] text-smoke">Nothing yet</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ash",
                    !n.read_at && "bg-surface-accent",
                  )}
                >
                  <span className="text-[13px] text-snow">{n.title}</span>
                  {n.body && <span className="text-[12px] text-smoke">{n.body}</span>}
                  <span className="text-[11px] text-faint">{formatRelativeTime(n.created_at)}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
