import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Link not available · Smark",
  robots: { index: false, follow: false },
};

/**
 * Renders for an unknown token, a regenerated (revoked) token, and an
 * archived project's token alike — `app/p/[token]/page.tsx` calls
 * `notFound()` in all three cases with no way to tell them apart from the
 * response (FEATURES §11 "token invalid = 404, no distinction leaked").
 */
export default function PortalNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-[14px] font-bold tracking-[0.14em] text-smark-orange uppercase">
        Smark
      </span>
      <h1 className="text-heading-sm font-medium text-snow">This link isn&apos;t available</h1>
      <p className="text-body-sm text-smoke">
        The project link you followed may have been revoked, or is no longer active. Please ask
        Smark for an updated link.
      </p>
    </main>
  );
}
