/**
 * Username ↔ synthetic-email mapping, mirrored from lib/auth/roles.ts (web
 * app). Not imported directly — that module pulls in "@/types/db" via the
 * web app's path alias, which isn't wired up in this Vite project — so this
 * is a deliberate, small, manually-kept-in-sync copy. If the synthetic
 * domain ever changes on the web side, it must change here too.
 */
const SYNTHETIC_EMAIL_DOMAIN = "smark.internal";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
