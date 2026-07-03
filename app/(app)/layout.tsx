import type { Metadata } from "next";
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
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <AppShell user={user}>{children}</AppShell>;
}
