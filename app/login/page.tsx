import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/login-form";
import { InstallPrompt } from "@/components/auth/install-prompt";
import { RegisterServiceWorker } from "@/components/shell/register-service-worker";

// app/layout.tsx (root) is integrator-locked, so the PWA manifest link is
// wired here instead (see also app/(app)/layout.tsx for the authed half) —
// Next merges metadata across the route tree into one <head>.
export const metadata: Metadata = {
  title: "Log in",
  manifest: "/manifest.json",
  icons: { apple: "/icons/apple-touch-icon.png" },
};

/**
 * `/login` — public route (auth-shell owns `app/login/**` per
 * docs/OWNERSHIP.md). Username + password (R2-01); already-signed-in users
 * bounce straight to /dashboard (middleware does the same on every later
 * request — this covers the direct first hit).
 */
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, #e6e9f2 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      />

      <div className="relative w-full max-w-[380px] rounded-2xl border border-charcoal bg-surface px-7 py-8">
        <div className="mb-[22px] flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image benefit for a one-off login logo */}
          <img src="/brand/smark-mark.svg" alt="Smark Automation" className="h-16 w-auto" />
        </div>
        <h1 className="text-center text-heading-sm font-normal text-snow">SmarkStock</h1>
        <p className="mt-1.5 text-center text-body-sm text-silver-mist">
          Every part, every box — one tap away.
        </p>

        <Suspense>
          <LoginForm />
        </Suspense>

        <InstallPrompt />

        <p className="mt-[22px] border-t border-border-faint pt-4 text-center text-[13px] text-faint">
          Runs on Smark&apos;s own Vercel · Supabase · Claude.
        </p>
      </div>

      <RegisterServiceWorker />
    </main>
  );
}
