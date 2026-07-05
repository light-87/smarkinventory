import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

/**
 * `/onboarding` — first-login gate for engineers (app/(app)/layout.tsx
 * redirects any `employee` with `onboarded_at is null` here, and skips the
 * redirect while already on this route — see that file's comment). Owners
 * and accountants never get redirected here by the layout; if one navigates
 * here directly anyway there's nothing for them to do, so send them back to
 * the dashboard rather than showing a pointless form.
 */
export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "employee") redirect("/dashboard");
  if (user.onboardedAt) redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-2 px-4 pt-8 pb-24 sm:px-6">
      <h1 className="text-[24px] font-normal text-snow">Welcome to SmarkStock</h1>
      <p className="mb-4 text-body-sm text-smoke">
        Before you get started, we need a few details for your employee record — date of birth, date of joining, and
        your bank details for payroll.
      </p>
      <OnboardingForm />
    </div>
  );
}
