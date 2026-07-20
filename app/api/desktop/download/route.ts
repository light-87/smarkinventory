/**
 * app/api/desktop/download/route.ts — public "Download desktop app" link.
 *
 * Redirects to a fresh presigned R2 URL for the current SmarkStock Desktop
 * installer (uploaded by scripts/upload-desktop-installer.ts to a fixed key).
 * Deliberately UNAUTHENTICATED: an employee who hasn't signed in yet still
 * needs to install the app first — the object is just an installer, not data.
 */

import { NextResponse } from "next/server";
import { getStorageAdapter, StorageNotFoundError } from "@/lib/storage";

/**
 * R2 key of the current installer. Uploaded manually to the `smark` bucket via
 * the Cloudflare dashboard (this network resets direct uploads > ~2 MB, so the
 * script can't push it from here). Bump this string when a new version is
 * uploaded, or re-point it to a stable "latest" key if uploads move there.
 */
export const DESKTOP_INSTALLER_KEY = "boms/SmarkStock Desktop_0.6.0_x64-setup.exe";

export async function GET(): Promise<NextResponse> {
  try {
    const url = await getStorageAdapter().signedUrl(DESKTOP_INSTALLER_KEY, { expiresInSeconds: 300 });
    return NextResponse.redirect(url, 302);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return NextResponse.json({ error: "The desktop installer isn't available yet." }, { status: 404 });
    }
    console.error("[desktop/download] failed to sign installer URL:", error);
    return NextResponse.json({ error: "Could not start the download. Please try again." }, { status: 500 });
  }
}
