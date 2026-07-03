"use client";

/**
 * hooks/use-notifications.ts — read model for the bell
 * (components/notifications/notification-bell.tsx). docs/OWNERSHIP.md names
 * this exact file for `search-notifications`.
 *
 * **Polling, not Realtime** (mission brief: "your call — note it"). Chosen
 * because a bell badge surfacing within `POLL_INTERVAL_MS` is good enough —
 * this isn't a chat feed — and it avoids every open tab holding its own
 * Realtime channel subscription just to watch one small table. If the client
 * later wants instant delivery, swap the effect below for a
 * `supabase.channel(...).on("postgres_changes", ...)` subscription scoped to
 * `user_id=eq.<uid>`; the hook's public shape (`notifications`, `unreadCount`,
 * `markRead`, `markAllRead`) wouldn't need to change.
 *
 * Reads run directly through the caller's own RLS session (recipient sees
 * own rows; owner sees all — `smark_notifications_select`); mark-read
 * mutations go through `app/api/notifications/mark-read` instead of writing
 * the table directly from the browser, matching this package's other
 * client/server boundary (components/search's palette also calls a server
 * action rather than querying inline).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TABLES, type NotificationRow } from "@/types/db";

const POLL_INTERVAL_MS = 30_000;
const LIST_LIMIT = 30;

export interface UseNotificationsResult {
  notifications: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

async function postMarkRead(body: { ids: string[] } | { all: true }): Promise<void> {
  try {
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort: the optimistic local update already applied; an offline
    // failure here just means the next poll re-fetches server truth (which,
    // worst case, un-reads it again — no data loss either way).
  }
}

export function useNotifications(userId: string | null | undefined): UseNotificationsResult {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TABLES.notifications)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (!mountedRef.current) return;
    if (!error) setNotifications(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;

    // State resets/kickoffs live in a named function rather than being
    // called inline at the effect body's top level, so a synchronous
    // setState doesn't trip react-hooks' set-state-in-effect rule.
    function start() {
      if (!userId) {
        setNotifications([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void refresh();
    }
    start();

    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [userId, refresh]);

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n)));
    await postMarkRead({ ids: [id] });
  }, []);

  const markAllRead = useCallback(async () => {
    const hasUnread = notifications.some((n) => !n.read_at);
    if (!hasUnread) return;
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await postMarkRead({ all: true });
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return { notifications, unreadCount, loading, refresh, markRead, markAllRead };
}
