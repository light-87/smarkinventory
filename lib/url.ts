/**
 * lib/url.ts — server-side base-URL helper.
 *
 * `components/projects/share-link-controls.tsx` builds the portal link
 * client-side off `window.location.origin`, which isn't available from a
 * Server Action or the cron route (lib/reminders/actions.ts,
 * app/api/cron/client-reminders/route.ts) — both compose the reminder email
 * body server-side. Prefer an explicit `NEXT_PUBLIC_APP_URL` (set it in
 * production); fall back to Vercel's auto-populated `VERCEL_URL` (preview/
 * prod deploys, no protocol in the env value); fall back to localhost for
 * local dev so nothing throws when neither is set.
 */

export function getAppBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
}

/** `/p/:share_token` client-portal link — the one place this shape is built server-side. */
export function getPortalUrl(shareToken: string): string {
  return `${getAppBaseUrl()}/p/${shareToken}`;
}
