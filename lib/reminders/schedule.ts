/**
 * lib/reminders/schedule.ts — pure date math for the reminder cadence, kept
 * separate from lib/reminders/actions.ts / app/api/cron/client-reminders so
 * it's trivially unit-testable without a Supabase client.
 *
 * Drift-avoidance rule: every bump (first send AND every cron resend) adds
 * `frequencyDays` to the reminder's own `next_send_at` (or `now` only on the
 * very first send, when there's no prior `next_send_at` yet) — never to
 * `now()` on a resend. Bumping off `now()` on every run would let the cadence
 * creep later each time the cron fires a little late; bumping off the
 * previous `next_send_at` keeps a "every 3 days" reminder landing on the same
 * time-of-day indefinitely.
 */

/** Adds `days` whole days to an ISO timestamp, returned as ISO (UTC-safe — no local-timezone drift). */
export function addDays(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/** First send: no prior `next_send_at` to bump off, so this one bumps off `now`. */
export function firstNextSendAt(now: Date, frequencyDays: number): string {
  return addDays(now.toISOString(), frequencyDays);
}
