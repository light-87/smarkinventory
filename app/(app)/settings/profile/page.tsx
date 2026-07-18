import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getOwnDocuments, getOwnPrivateFields, getOwnProfile } from "@/lib/employees/queries";
import { ProfileForm } from "@/components/employees/profile-form";
import { ChangePasswordCard } from "@/components/employees/change-password-card";
import { DocumentsCard } from "@/components/employees/documents-card";

export const metadata: Metadata = { title: "My Profile" };

/**
 * `/settings/profile` — every role's own profile edit (DOB / date of joining
 * / PAN / bank details) + document uploads (`profile` area, roles.ts:
 * `self` for everyone — no `notFound()`-by-role gate needed here, only "is
 * there a session at all", same as `/onboarding`). Visible in nav to every
 * role (lib/nav.ts), unlike the owner-only `/settings` hub.
 */
export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [profile, privateFields, documents] = await Promise.all([
    getOwnProfile(supabase, user.id),
    getOwnPrivateFields(supabase, user.id),
    getOwnDocuments(supabase, user.id),
  ]);

  if (!profile) redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <h1 className="text-[24px] font-normal text-snow">My Profile</h1>
      <ProfileForm profile={profile} privateFields={privateFields} />
      <ChangePasswordCard />
      <DocumentsCard documents={documents} />
    </div>
  );
}
