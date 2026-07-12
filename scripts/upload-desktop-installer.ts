/**
 * scripts/upload-desktop-installer.ts — push the built SmarkStock Desktop
 * installer to R2 so the in-app "Download desktop app" button (via
 * /api/desktop/download) serves the latest release.
 *
 * Usage (from repo root, with prod CLOUDFLARE_R2_* env available):
 *   bun run scripts/upload-desktop-installer.ts "<path-to>/SmarkStock Desktop_0.3.0_x64-setup.exe"
 *
 * Re-runnable: it overwrites the single fixed key each release.
 */

import { readFileSync } from "node:fs";
import { getStorageAdapter } from "@/lib/storage";
import { DESKTOP_INSTALLER_KEY } from "@/app/api/desktop/download/route";

async function main() {
  const exePath = process.argv[2];
  if (!exePath) {
    console.error('Pass the installer path, e.g. bun run scripts/upload-desktop-installer.ts "desktop/app/src-tauri/target/release/bundle/nsis/SmarkStock Desktop_0.3.0_x64-setup.exe"');
    process.exit(1);
  }

  const bytes = readFileSync(exePath);
  console.log(`Uploading ${exePath} (${(bytes.byteLength / 1_000_000).toFixed(1)} MB) → ${DESKTOP_INSTALLER_KEY} …`);

  const result = await getStorageAdapter().put({
    key: DESKTOP_INSTALLER_KEY,
    body: new Uint8Array(bytes),
    contentType: "application/octet-stream",
  });

  console.log(`✓ Uploaded. key=${result.key} size=${result.size} bytes`);
  console.log("The in-app Download desktop app button now serves this build.");
}

main().catch((error) => {
  console.error("Upload failed:", error);
  process.exit(1);
});
