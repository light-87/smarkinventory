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

/** Fixed key the upload script writes to — one "latest" object, overwritten per release. */
export const DESKTOP_INSTALLER_KEY = "desktop/SmarkStock-Desktop-latest-setup.exe";

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
