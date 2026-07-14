/**
 * GET /api/desktop/version — public. Tells the desktop app the latest published
 * version + where to download it, so an outdated install can nag the user to
 * update. Unauthenticated (same rationale as /api/desktop/download).
 */

import { NextResponse } from "next/server";
import { LATEST_DESKTOP_VERSION } from "@/lib/desktop/version";

/**
 * A TRUSTED absolute origin from server-side config only — never `request.url`
 * (that's Host-header controlled, so echoing it into a download link the
 * desktop app follows would be host-header injection). Falls back to a relative
 * path when no canonical origin is configured (local dev).
 */
function canonicalOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL; // set by Vercel; the canonical prod host
  return vercel ? `https://${vercel}` : null;
}

export async function GET(): Promise<NextResponse> {
  const origin = canonicalOrigin();
  return NextResponse.json({
    latest: LATEST_DESKTOP_VERSION,
    downloadPath: "/api/desktop/download",
    ...(origin ? { downloadUrl: `${origin}/api/desktop/download` } : {}),
  });
}
