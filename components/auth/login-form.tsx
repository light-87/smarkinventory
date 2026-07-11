"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usernameToEmail } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EyeIcon, EyeOffIcon } from "@/components/shell/icons";

/**
 * Username + password login (R2-01 — supersedes the v1 PIN gate).
 * Client-side `signInWithPassword`: the `@supabase/ssr` browser client
 * stores the session in cookies itself, so middleware/Server Components see
 * it on the very next navigation — no Route Handler round-trip needed.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [pending, startTransition] = useTransition();

  function triggerShake() {
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      triggerShake();
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });

      if (signInError) {
        setError("Incorrect username or password.");
        setPassword("");
        triggerShake();
        return;
      }

      // A valid Supabase session doesn't guarantee an active smark_app_users
      // row (smark_role() returns NULL for deactivated accounts) — check
      // before routing in, rather than letting middleware bounce them back
      // here after a confusing flash of the app shell.
      const { data: role } = await supabase.rpc("smark_role");
      if (!role) {
        await supabase.auth.signOut();
        setError("This account has been deactivated. Contact your owner.");
        triggerShake();
        return;
      }

      const next = searchParams.get("next");
      const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      router.replace(destination);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <div className={shake ? "animate-shake flex flex-col gap-4" : "flex flex-col gap-4"}>
        <Field label="Username" htmlFor="login-username">
          <Input
            id="login-username"
            autoFocus
            autoComplete="username"
            placeholder="e.g. suresh"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            invalid={Boolean(error)}
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={Boolean(error)}
              className="pr-10"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((s) => !s)}
              className="absolute top-1/2 right-3 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center text-smoke hover:text-snow"
            >
              <span aria-hidden className="size-4 [&_svg]:size-full">
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </span>
            </button>
          </div>
        </Field>
      </div>

      {error && <p className="text-center text-[14px] text-smark-orange-soft">{error}</p>}

      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} className="mt-1">
        {pending ? "Signing in…" : "Log in"}
      </Button>
    </form>
  );
}
