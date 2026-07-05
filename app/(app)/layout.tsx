import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/app-shell";

// app/layout.tsx (root) is integrator-locked, so the PWA manifest link is
// wired here instead — Next merges route-tree metadata, and this layout
// wraps every authed screen (see also app/login/page.tsx for the other half).
export const metadata: Metadata = {
  manifest: "/manifest.json",
  icons: { apple: "/icons/apple-touch-icon.png" },
};

/**
 * The shared app shell (auth-shell owns this file exclusively —
 * docs/OWNERSHIP.md). Gates every `(app)` route: no session (or a
 * deactivated account) → /login. Role is resolved ONCE here and threaded
 * into AppShell, which renders the rail/header/bottom-bar/More-sheet chrome
 * around whatever page the URL matches.
 *
 * (0011) Onboarding gate: an `employee` whose `smark_app_users.onboarded_at`
 * is still null must complete DOB + date_of_joining + bank details before
 * using anything else — enforced HERE (server-side, on the resolved session
 * user) rather than client-side, so it can't be bypassed by typing another
 * URL directly. Owners/accountants are never gated, regardless of
 * `onboardedAt` (that column has no meaning for them). The one thing this
 * check must avoid is looping /onboarding → /onboarding: `middleware.ts`
 * forwards the current pathname as the `x-pathname` request header (Server
 * Components have no other way to read it), so the check is skipped while
 * already on /onboarding — that route renders normally for a not-yet-
 * onboarded employee and lets them navigate away themselves once done
 * (the onboarding Server Action itself redirects on submit, too).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (user.role === "employee" && !user.onboardedAt) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!pathname.startsWith("/onboarding")) redirect("/onboarding");
  }

  return <AppShell user={user}>{children}</AppShell>;
}
