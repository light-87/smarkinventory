import { redirect } from "next/navigation";

/**
 * Root route: always aim at /dashboard. Middleware (repo root) already
 * bounces a signed-out visitor to /login (with `?next=/dashboard`) before
 * this component ever renders, so there's no session check to duplicate
 * here — see middleware.ts + app/(app)/layout.tsx for the actual gate.
 */
export default function Home() {
  redirect("/dashboard");
}
