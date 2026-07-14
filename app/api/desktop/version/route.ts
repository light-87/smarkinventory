/**
 * GET /api/desktop/version — public. Tells the desktop app the latest published
 * version + where to download it, so an outdated install can nag the user to
 * update. Unauthenticated (same rationale as /api/desktop/download).
 */

import { NextResponse } from "next/server";
import { LATEST_DESKTOP_VERSION } from "@/lib/desktop/version";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ latest: LATEST_DESKTOP_VERSION, downloadPath: "/api/desktop/download" });
}
